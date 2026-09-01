import { useCall } from '../context/CallContext.jsx';
import Avatar from './Avatar.jsx';
import DisplayName from './DisplayName.jsx';

export default function IncomingCallModal() {
  const { incomingCall, acceptCall, declineCall } = useCall();
  if (!incomingCall) return null;

  return (
    <div className="call-modal-backdrop">
      <div className="call-modal ringing">
        <Avatar user={incomingCall.from} size={88} />
        <DisplayName user={incomingCall.from} className="call-modal-name" />
        <p className="call-modal-sub">Incoming {incomingCall.callType} call…</p>
        <div className="call-modal-actions">
          <button className="btn-round btn-decline" onClick={declineCall} aria-label="Decline">
            ✕
          </button>
          <button className="btn-round btn-accept" onClick={acceptCall} aria-label="Accept">
            {incomingCall.callType === 'video' ? '🎥' : '📞'}
          </button>
        </div>
      </div>
    </div>
  );
}
