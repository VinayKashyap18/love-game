import { useState, useEffect, useRef } from 'react'
import io from 'socket.io-client'
import { motion, AnimatePresence } from 'framer-motion'
import Peer from 'simple-peer'
import './App.css'

// Use a dynamic server URL - for local dev it's 3001, 
// for production it should be set via VITE_SERVER_URL env var
const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
const socket = io(SERVER_URL);

const FloatingHearts = () => {
  const [hearts, setHearts] = useState([]);

  useEffect(() => {
    const interval = setInterval(() => {
      const id = Date.now();
      const left = Math.random() * 100;
      const size = 10 + Math.random() * 20;
      const duration = 15 + Math.random() * 10;
      
      setHearts(prev => [...prev, { id, left, size, duration }]);

      // Remove heart after animation
      setTimeout(() => {
        setHearts(prev => prev.filter(h => h.id !== id));
      }, duration * 1000);
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="floatingHearts">
      {hearts.map(heart => (
        <div
          key={heart.id}
          className="heart"
          style={{
            left: `${heart.left}%`,
            width: `${heart.size}px`,
            height: `${heart.size}px`,
            animationDuration: `${heart.duration}s`
          }}
        />
      ))}
    </div>
  );
};

function App() {
  const [roomId, setRoomId] = useState('')
  const [joined, setJoined] = useState(false)
  const [role, setRole] = useState(null) // '1' or '2'
  const [gameState, setGameState] = useState(null)
  const [players, setPlayers] = useState({})
  const [error, setError] = useState('')
  const [rating, setRating] = useState(8)
  const [time, setTime] = useState(new Date().toLocaleTimeString())
  
  // Persistent Identifier
  const playerId = useRef(localStorage.getItem('love-game-player-id') || Math.random().toString(36).substring(2) + Date.now().toString(36));
  
  // WebRTC State
  const [stream, setStream] = useState(null)
  const [peerStream, setPeerStream] = useState(null)
  const [callStatus, setCallStatus] = useState('idle') // idle, calling, connected, receiving
  const [incomingSignal, setIncomingSignal] = useState(null)
  const [micEnabled, setMicEnabled] = useState(true)
  const [videoEnabled, setVideoEnabled] = useState(true)
  
  const myVideo = useRef()
  const peerVideo = useRef()
  const connectionRef = useRef()

  useEffect(() => {
    localStorage.setItem('love-game-player-id', playerId.current);
    
    // Check for existing room to rejoin
    const savedRoomId = localStorage.getItem('love-game-room-id');
    if (savedRoomId) {
      socket.emit('rejoin-room', { roomId: savedRoomId, playerId: playerId.current });
    }

    const timer = setInterval(() => setTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    socket.on('room-created', ({ roomId, gameState }) => {
      setRoomId(roomId)
      setGameState(gameState)
      setJoined(true)
      localStorage.setItem('love-game-room-id', roomId);
    })

    socket.on('room-joined', ({ roomId, gameState, players, role: rejoinedRole }) => {
      setRoomId(roomId)
      setGameState(gameState)
      setPlayers(players)
      setJoined(true)
      localStorage.setItem('love-game-room-id', roomId);
      if (rejoinedRole) {
        setRole(rejoinedRole);
        localStorage.setItem('love-game-role', rejoinedRole);
      }
    })

    socket.on('player-update', (updatedPlayers) => {
      setPlayers(updatedPlayers)
    })

    socket.on('state-update', (newState) => {
      setGameState(newState)
    })

    socket.on('error', (err) => {
      setError(err)
      // If re-joining fails, clear local storage
      if (err === 'Could not rejoin room') {
        localStorage.removeItem('love-game-room-id');
        localStorage.removeItem('love-game-role');
      }
      setTimeout(() => setError(''), 3000)
    })

    socket.on('connect_error', () => {
      setError('Cannot connect to server. Is the backend running?')
    })

    socket.on('webrtc-signal', ({ signal, from }) => {
      console.log('Received WebRTC signal');
      if (connectionRef.current) {
        console.log('Existing connection found, signaling...');
        connectionRef.current.signal(signal)
      } else {
        console.log('New incoming call, signaling for manual accept...');
        setIncomingSignal(signal)
        setCallStatus('receiving')
      }
    })

    socket.on('webrtc-end-call', () => {
      cleanupCall()
    })

    return () => {
      socket.off('webrtc-end-call')
      socket.off('room-created')
      socket.off('room-joined')
      socket.off('player-update')
      socket.off('state-update')
      socket.off('error')
    }
  }, [])

  const createRoom = () => socket.emit('create-room')
  const joinRoom = (e) => {
    e.preventDefault()
    const id = e.target.roomId.value
    if (id) socket.emit('join-room', id)
  }

  const selectRole = (r) => {
    setRole(r)
    localStorage.setItem('love-game-role', r);
    socket.emit('select-role', { roomId, role: r, playerId: playerId.current })
  }

  const pickNumber = (num) => {
    if (gameState.currentPlayer.toString() === role && gameState.phase === 'picking') {
      socket.emit('pick-number', { roomId, number: num })
    }
  }

  const finishAnswering = () => {
    if (gameState.currentPlayer.toString() === role && gameState.phase === 'answering') {
      socket.emit('finish-answering', { roomId })
    }
  }

  const submitRating = () => {
    // Only the OTHER player rates
    if (gameState.currentPlayer.toString() !== role && gameState.phase === 'rating') {
      socket.emit('submit-rating', { roomId, rating })
    }
  }

  const nextLevel = () => {
    socket.emit('next-level', { roomId })
  }

  const cleanupCall = () => {
    if (connectionRef.current) {
      connectionRef.current.destroy()
      connectionRef.current = null
    }
    setCallStatus('idle')
    setPeerStream(null)
    if (peerVideo.current) peerVideo.current.srcObject = null
  }

  const answerCall = () => {
    if (!incomingSignal) return;
    console.log('Answering call...');
    navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then((currentStream) => {
      console.log('Stream acquired for answering');
      setStream(currentStream)
      if (myVideo.current) myVideo.current.srcObject = currentStream
      setMicEnabled(true)
      setVideoEnabled(true)
      
      try {
        console.log('Initializing Peer (Responder)');
        const peer = new Peer({ initiator: false, trickle: false, stream: currentStream })
        
        peer.on('signal', (data) => {
          console.log('Peer generated signal (Responder)');
          socket.emit('webrtc-signal', { roomId, signal: data })
        })
        
        peer.on('stream', (remoteStream) => {
          console.log('Peer remote stream received (Responder)');
          setPeerStream(remoteStream)
          if (peerVideo.current) peerVideo.current.srcObject = remoteStream
        })
        
        peer.on('error', (err) => {
          console.error('Peer error (Responder):', err);
          setError(`Peer Error: ${err.message || err.name || 'Unknown'}`);
        });

        peer.on('close', cleanupCall)
        
        console.log('Signaling peer with incoming data...');
        peer.signal(incomingSignal)
        connectionRef.current = peer
        setCallStatus('connected')
        setIncomingSignal(null)
      } catch (err) {
        console.error('Peer creation/init failed:', err);
        setError(`Connection Error: ${err.message || 'Check browser console'}`);
      }
    }).catch(err => {
      console.error("Media error during answering:", err);
      setError(`Camera/Mic Error: ${err.name || 'Error'} - ${err.message || 'Check permissions'}`);
    })
  }

  const startCall = () => {
    console.log('Starting call...');
    navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then((currentStream) => {
      console.log('Stream acquired for starting call');
      setStream(currentStream)
      if (myVideo.current) myVideo.current.srcObject = currentStream
      setMicEnabled(true)
      setVideoEnabled(true)

      try {
        console.log('Initializing Peer (Initiator)');
        const peer = new Peer({ initiator: true, trickle: false, stream: currentStream })
        
        peer.on('signal', (data) => {
          console.log('Peer generated signal (Initiator)');
          socket.emit('webrtc-signal', { roomId, signal: data })
        })
        
        peer.on('stream', (remoteStream) => {
          console.log('Peer remote stream received (Initiator)');
          setPeerStream(remoteStream)
          if (peerVideo.current) peerVideo.current.srcObject = remoteStream
          setCallStatus('connected')
        })

        peer.on('error', (err) => {
          console.error('Peer error (Initiator):', err);
          setError(`Peer Error: ${err.message || err.name || 'Unknown'}`);
        });

        peer.on('close', cleanupCall)
        connectionRef.current = peer
        setCallStatus('calling')
      } catch (err) {
        console.error('Peer creation failed:', err);
        setError(`Call Initialization Error: ${err.message || 'Check console'}`);
      }
    }).catch(err => {
      console.error("Media error during call start:", err);
      setError(`Camera/Mic Error: ${err.name || 'Error'} - ${err.message || 'Check permissions'}`);
    })
  }

  const endCall = () => {
    socket.emit('webrtc-end-call', { roomId });
    cleanupCall();
    
    // Stop local camera tracks if we want to turn off the camera light
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  };

  const toggleMic = () => {
    if (stream) {
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setMicEnabled(audioTrack.enabled);
      }
    }
  };

  const toggleVideo = () => {
    if (stream) {
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setVideoEnabled(videoTrack.enabled);
      }
    }
  };

  if (!joined) {
    return (
      <div className="container animate-fade">
        <FloatingHearts />
        <div className="glass-card">
          <span className="badge">Connection</span>
          <h1>Love Game 💖</h1>
          <p style={{ color: 'var(--text-dim)', marginBottom: '2rem' }}>A deep connection experience for couples.</p>
          
          <button className="btn btn-primary" onClick={createRoom} style={{ width: '100%', marginBottom: '10px' }}>
            Create New Room
          </button>
          
          <div style={{ margin: '20px 0', display: 'flex', alignItems: 'center' }}>
            <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.1)' }}></div>
            <span style={{ margin: '0 10px', fontSize: '0.8rem', color: 'var(--text-dim)' }}>OR JOIN</span>
            <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.1)' }}></div>
          </div>

          <form onSubmit={joinRoom}>
            <div className="input-group">
              <input type="text" name="roomId" placeholder="Enter 6-digit Code" required />
            </div>
            <button className="btn btn-secondary" type="submit" style={{ width: '100%' }}>
              Join Room
            </button>
          </form>
          {error && <p style={{ color: '#ff4d4d', marginTop: '10px' }}>{error}</p>}
        </div>
      </div>
    )
  }

  if (!role) {
    return (
      <div className="container animate-fade">
        <FloatingHearts />
        <div className="glass-card">
          <span className="badge">Room: {roomId}</span>
          <h2>Who are you?</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginTop: '20px' }}>
            <button 
              className="btn btn-secondary" 
              onClick={() => selectRole('1')}
              disabled={Object.values(players).includes('1')}
            >
              Player 1
              <p style={{ fontSize: '0.7rem', marginTop: '5px' }}>{Object.values(players).includes('1') ? 'Taken' : 'Available'}</p>
            </button>
            <button 
              className="btn btn-secondary" 
              onClick={() => selectRole('2')}
              disabled={Object.values(players).includes('2')}
            >
              Player 2
              <p style={{ fontSize: '0.7rem', marginTop: '5px' }}>{Object.values(players).includes('2') ? 'Taken' : 'Available'}</p>
            </button>
          </div>
          <p style={{ marginTop: '20px', color: 'var(--text-dim)' }}>Waiting for both players to join...</p>
        </div>
      </div>
    )
  }

  // Waiting for opponent to select role
  if (gameState.phase === 'lobby') {
    return (
      <div className="container animate-fade">
        <FloatingHearts />
        <div className="glass-card">
          <span className="badge">Room: {roomId}</span>
          <h2>Waiting for Opponent...</h2>
          <p style={{ color: 'var(--text-dim)' }}>Share code <strong>{roomId}</strong> with your partner.</p>
          <div className="loading-dots" style={{ marginTop: '20px' }}>
            <span>.</span><span>.</span><span>.</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="container animate-fade" style={{ display: 'flex', gap: '20px', alignItems: 'flex-start', maxWidth: '1200px' }}>
      <FloatingHearts />
      {/* Video Sidebar */}
      <div className="video-sidebar">
        {error && <div style={{ background: 'rgba(255, 77, 77, 0.2)', border: '1px solid #ff4d4d', color: '#ff4d4d', padding: '10px', borderRadius: '10px', fontSize: '0.9rem', marginBottom: '10px' }}>{error}</div>}
        <div className="glass-card video-container" style={{ position: 'relative' }}>
          <video 
            playsInline 
            muted 
            ref={myVideo} 
            autoPlay 
            style={{ 
              width: '100%', 
              borderRadius: '15px', 
              transform: 'scaleX(-1)', 
              display: (stream && videoEnabled) ? 'block' : 'none' 
            }} 
          />
          {(!stream || !videoEnabled) && (
            <div className="video-placeholder">
              {!stream ? 'Camera Off' : 'Video Paused'}
            </div>
          )}
          <div className="video-label">You {!micEnabled && ' (Muted)'}</div>
          {stream && (
            <div style={{ position: 'absolute', bottom: '15px', left: '0', right: '0', display: 'flex', justifyContent: 'center', gap: '10px', zIndex: 10 }}>
              <button 
                onClick={toggleMic} 
                style={{ background: micEnabled ? 'rgba(0,0,0,0.6)' : 'rgba(255,50,50,0.8)', border: 'none', borderRadius: '50%', width: '35px', height: '35px', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem' }}
                title={micEnabled ? "Mute" : "Unmute"}
              >
                {micEnabled ? '🎤' : '🔇'}
              </button>
              <button 
                onClick={toggleVideo} 
                style={{ background: videoEnabled ? 'rgba(0,0,0,0.6)' : 'rgba(255,50,50,0.8)', border: 'none', borderRadius: '50%', width: '35px', height: '35px', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem' }}
                title={videoEnabled ? "Stop Video" : "Start Video"}
              >
                {videoEnabled ? '📹' : '❌'}
              </button>
            </div>
          )}
        </div>
        <div className="glass-card video-container" style={{ position: 'relative' }}>
          <video 
            playsInline 
            ref={peerVideo} 
            autoPlay 
            style={{ width: '100%', borderRadius: '15px', display: peerStream ? 'block' : 'none' }} 
          />
          {!peerStream && (
            <div className="video-placeholder">
              Partner Offline
            </div>
          )}
          <div className="video-label">
             Partner {callStatus === 'calling' && ' (Ringing...)'}
          </div>
        </div>
        {callStatus === 'idle' ? (
          <button className="btn btn-secondary" onClick={startCall} style={{ width: '100%' }}>
            Start Video Call
          </button>
        ) : callStatus === 'receiving' ? (
          <button className="btn btn-primary" onClick={answerCall} style={{ width: '100%', background: '#4CAF50', borderColor: '#4CAF50' }}>
            Answer Video Call 📞
          </button>
        ) : (
          <button className="btn btn-secondary" onClick={endCall} style={{ width: '100%', background: '#ff4d4d', color: 'white', borderColor: '#ff4d4d' }}>
             {callStatus === 'calling' ? 'Cancel Call' : 'End Call'}
          </button>
        )}
      </div>

      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '10px' }}>
            <span className="badge">Level {gameState.level}</span>
            <span className="badge">Turn {gameState.turn}/10</span>
          </div>
          <div className="digital-clock">{time}</div>
        </div>

        <div className="glass-card">
        {gameState.phase === 'finished' ? (
          <div className="animate-fade">
            <h2>Game Over ❤️</h2>
            <p style={{ marginBottom: '20px' }}>You've completed all levels! Here are your averages:</p>
            <div className="stats-list">
              {gameState.allScores.map((s, i) => (
                <div key={i} className="stat-row" style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <span>Level {s.level}</span>
                  <span>P1: {s.p1.toFixed(1)} | P2: {s.p2.toFixed(1)}</span>
                </div>
              ))}
            </div>
            <button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: '30px', width: '100%' }}>Play Again</button>
          </div>
        ) : gameState.phase === 'level-summary' ? (
          <div className="animate-fade">
            <h2>Level {gameState.level} Complete</h2>
            <div style={{ margin: '30px 0' }}>
              <p>P1 Average: {gameState.allScores[gameState.allScores.length-1].p1.toFixed(1)}</p>
              <p>P2 Average: {gameState.allScores[gameState.allScores.length-1].p2.toFixed(1)}</p>
            </div>
            {gameState.currentPlayer.toString() === role ? (
              <button className="btn btn-primary" onClick={nextLevel} style={{ width: '100%' }}>Next Level</button>
            ) : (
              <p>Waiting for Player {gameState.currentPlayer} to start next level...</p>
            )}
          </div>
        ) : (
          <>
            <div className="status-bar" style={{ marginBottom: '20px', color: 'var(--accent-pink)', fontWeight: '600' }}>
              {gameState.currentPlayer.toString() === role ? "IT'S YOUR TURN" : "OPPONENT'S TURN"}
            </div>

            <AnimatePresence mode="wait">
              {gameState.phase === 'picking' && (
                <motion.div 
                  key="picking"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  <p style={{ color: 'var(--text-dim)', marginBottom: '20px' }}>
                    {gameState.currentPlayer.toString() === role ? "Pick a number to reveal a question" : "Opponent is picking a number..."}
                  </p>
                  <div className="grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
                    {[...Array(10)].map((_, i) => (
                      <div 
                        key={i+1} 
                        className={`grid-item ${gameState.usedNumbers.includes(i+1) ? 'used' : ''}`}
                        onClick={() => pickNumber(i+1)}
                      >
                        {i+1}
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}

              {gameState.phase === 'answering' && (
                <motion.div 
                  key="answering"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 1.05 }}
                >
                  <div style={{ padding: '20px', background: 'rgba(255,255,255,0.02)', borderRadius: '20px', border: '1px dashed rgba(255,255,255,0.1)' }}>
                    <p style={{ fontSize: '0.8rem', color: 'var(--accent-pink)', marginBottom: '10px', textTransform: 'uppercase' }}>The Question</p>
                    <h2 style={{ fontSize: '2rem' }}>{gameState.currentQuestion}</h2>
                  </div>
                  <div style={{ marginTop: '30px' }}>
                    {gameState.currentPlayer.toString() === role ? (
                      <button className="btn btn-primary" onClick={finishAnswering} style={{ width: '100%' }}>Done Answering</button>
                    ) : (
                      <p style={{ color: 'var(--text-dim)' }}>Opponent is answering... Listen closely! ❤️</p>
                    )}
                  </div>
                </motion.div>
              )}

              {gameState.phase === 'rating' && (
                <motion.div 
                  key="rating"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                >
                  {gameState.currentPlayer.toString() !== role ? (
                    <div>
                      <h2>How was the answer?</h2>
                      <p style={{ color: 'var(--text-dim)', marginBottom: '30px' }}>Rate based on vulnerability and honesty (1-10)</p>
                      <div className="input-group">
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                          <span>Scale</span>
                          <span style={{ color: 'var(--accent-pink)', fontWeight: '700', fontSize: '1.5rem' }}>{rating}</span>
                        </div>
                        <input 
                          type="range" 
                          min="1" 
                          max="10" 
                          step="0.5" 
                          value={rating} 
                          onChange={(e) => setRating(e.target.value)}
                          style={{ width: '100%', accentColor: 'var(--accent-pink)' }}
                        />
                      </div>
                      <button className="btn btn-primary" onClick={submitRating} style={{ width: '100%', marginTop: '20px' }}>Submit Rating</button>
                    </div>
                  ) : (
                    <div>
                      <h2>Waiting for Rating</h2>
                      <p style={{ color: 'var(--text-dim)' }}>Your partner is rating your response...</p>
                      <div className="loading-dots" style={{ marginTop: '20px' }}>
                        <span>.</span><span>.</span><span>.</span>
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </div>
    </div>
  </div>
  )
}

export default App
