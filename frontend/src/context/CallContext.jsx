import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { useSocket } from './SocketContext.jsx';
import { vibrate, notifyIfAway } from '../lib/notify.js';
import { getNotificationPrefs } from '../lib/notificationPrefs.js';

const CallContext = createContext(null);

// public stun server, free, no account needed -- enough for two peers to
// discover a direct path on most home/mobile networks. a flaky call across
// a stricter NAT (symmetric NAT, some corporate wifi) is the known
// tradeoff of skipping a TURN relay server, which costs money to run --
// not worth it for a birthday present. see README for how to add one later.
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

// the server is a dumb relay for offer/answer/ICE candidates (see
// backend/src/sockets/index.js) -- everything about the actual call
// (audio/video setup, peer connection, negotiation) happens here.
export function CallProvider({ children }) {
  const { socket } = useSocket();
  const [incomingCall, setIncomingCall] = useState(null); // { callId, conversationId, callType, from }
  const [activeCall, setActiveCall] = useState(null); // { callId, otherUserId, otherUser, callType, status }
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [error, setError] = useState(null);

  const peerRef = useRef(null);
  const wasConnectedRef = useRef(false);

  const cleanup = useCallback(() => {
    peerRef.current?.close();
    peerRef.current = null;
    localStream?.getTracks().forEach((t) => t.stop());
    setLocalStream(null);
    setRemoteStream(null);
    setActiveCall(null);
    wasConnectedRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localStream]);

  function buildPeerConnection(otherUserId, callId) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('call:signal', { toUserId: otherUserId, callId, data: { kind: 'ice', candidate: event.candidate } });
      }
    };
    pc.ontrack = (event) => {
      setRemoteStream(event.streams[0]);
      wasConnectedRef.current = true;
      setActiveCall((prev) => (prev ? { ...prev, status: 'connected' } : prev));
    };
    peerRef.current = pc;
    return pc;
  }

  async function getMedia(callType) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: callType === 'video' ? { facingMode: 'user' } : false,
    });
    setLocalStream(stream);
    return stream;
  }

  const startCall = useCallback(
    async (otherUser, callType) => {
      try {
        setError(null);
        await getMedia(callType);
        setActiveCall({ callId: null, otherUserId: otherUser.id, otherUser, callType, status: 'calling' });
        socket.emit('call:invite', { toUserId: otherUser.id, callType });
      } catch (err) {
        setError(err.message?.includes('Permission') ? 'camera/mic permission was denied' : 'could not start the call');
      }
    },
    [socket],
  );

  const acceptCall = useCallback(async () => {
    if (!incomingCall) return;
    try {
      setError(null);
      await getMedia(incomingCall.callType);
      setActiveCall({
        callId: incomingCall.callId,
        otherUserId: incomingCall.from.id,
        otherUser: incomingCall.from,
        callType: incomingCall.callType,
        status: 'connecting',
      });
      socket.emit('call:accept', { toUserId: incomingCall.from.id, callId: incomingCall.callId });
      setIncomingCall(null);
    } catch (err) {
      setError('could not join the call');
      setIncomingCall(null);
    }
  }, [incomingCall, socket]);

  const declineCall = useCallback(() => {
    if (!incomingCall) return;
    socket.emit('call:decline', { toUserId: incomingCall.from.id, callId: incomingCall.callId });
    setIncomingCall(null);
  }, [incomingCall, socket]);

  const endCall = useCallback(() => {
    if (activeCall) {
      socket.emit('call:end', { toUserId: activeCall.otherUserId, callId: activeCall.callId, wasConnected: wasConnectedRef.current });
    }
    cleanup();
  }, [activeCall, socket, cleanup]);

  useEffect(() => {
    if (!socket) return;

    socket.on('call:incoming', (payload) => {
      // already on a call -- silently let the caller time out rather than
      // interrupting a live conversation with a modal
      setActiveCall((current) => {
        if (!current) {
          setIncomingCall(payload);
          if (getNotificationPrefs().calls) {
            // ring even if the tab's focused -- a call is urgent enough that
            // the in-app modal alone isn't necessarily going to be noticed
            vibrate([400, 200, 400, 200, 400, 200, 400]);
            notifyIfAway(`Incoming ${payload.callType} call`, {
              body: `${payload.from?.display_name || 'Someone'} is calling…`,
              tag: 'vonbook-call',
            });
          }
        }
        return current;
      });
    });

    // the CALLER hears this once the callee accepts: time to actually build
    // the peer connection and send the offer
    socket.on('call:accepted', async ({ callId, fromUserId }) => {
      setActiveCall((prev) => (prev && prev.status === 'calling' ? { ...prev, callId, status: 'connecting' } : prev));
      const pc = buildPeerConnection(fromUserId, callId);
      const stream = localStream;
      stream?.getTracks().forEach((track) => pc.addTrack(track, stream));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('call:signal', { toUserId: fromUserId, callId, data: { kind: 'offer', sdp: offer } });
    });

    socket.on('call:signal', async ({ fromUserId, data }) => {
      if (data.kind === 'offer') {
        // the CALLEE gets the offer after already having accepted -- build
        // the peer connection now, attach local tracks, answer
        let pc = peerRef.current;
        if (!pc) {
          pc = buildPeerConnection(fromUserId, activeCall?.callId);
          localStream?.getTracks().forEach((track) => pc.addTrack(track, localStream));
        }
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('call:signal', { toUserId: fromUserId, callId: activeCall?.callId, data: { kind: 'answer', sdp: answer } });
      } else if (data.kind === 'answer') {
        await peerRef.current?.setRemoteDescription(new RTCSessionDescription(data.sdp));
      } else if (data.kind === 'ice' && data.candidate) {
        try {
          await peerRef.current?.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch {
          // a candidate that arrives before setRemoteDescription completes
          // is harmless to drop -- more will follow
        }
      }
    });

    socket.on('call:declined', () => {
      cleanup();
      setError('call declined');
    });

    socket.on('call:ended', () => {
      cleanup();
    });

    return () => {
      socket.off('call:incoming');
      socket.off('call:accepted');
      socket.off('call:signal');
      socket.off('call:declined');
      socket.off('call:ended');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, localStream, activeCall?.callId]);

  return (
    <CallContext.Provider
      value={{ incomingCall, activeCall, localStream, remoteStream, error, startCall, acceptCall, declineCall, endCall, clearError: () => setError(null) }}
    >
      {children}
    </CallContext.Provider>
  );
}

export function useCall() {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error('useCall must be used inside a CallProvider');
  return ctx;
}
