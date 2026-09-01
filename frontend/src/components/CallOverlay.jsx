import { useEffect, useRef } from 'react';
import { useCall } from '../context/CallContext.jsx';
import Avatar from './Avatar.jsx';
import DisplayName from './DisplayName.jsx';

export default function CallOverlay() {
  const { activeCall, localStream, remoteStream, endCall } = useCall();
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);

  useEffect(() => {
    if (localVideoRef.current) localVideoRef.current.srcObject = localStream || null;
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream || null;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = remoteStream || null;
  }, [remoteStream]);

  if (!activeCall) return null;

  const isVideo = activeCall.callType === 'video';
  const statusLabel = { calling: 'Calling…', connecting: 'Connecting…', connected: 'Connected' }[activeCall.status] || '';

  return (
    <div className="call-overlay">
      {isVideo ? (
        <>
          <video ref={remoteVideoRef} className="call-remote-video" autoPlay playsInline />
          <video ref={localVideoRef} className="call-local-video" autoPlay playsInline muted />
        </>
      ) : (
        <>
          <audio ref={remoteAudioRef} autoPlay />
          <div className="call-audio-face">
            <Avatar user={activeCall.otherUser} size={120} />
          </div>
        </>
      )}

      <div className="call-overlay-header">
        <DisplayName user={activeCall.otherUser} className="call-overlay-name" />
        <span className="call-overlay-status">{statusLabel}</span>
      </div>

      <button className="btn-round btn-decline call-overlay-hangup" onClick={endCall} aria-label="Hang up">
        ✕
      </button>
    </div>
  );
}
