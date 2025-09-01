import { useEffect, useRef, useState } from "react";

export default function WebRTCClient() {
  // Refs for WebSocket, RTCPeerConnection, and video element
  const wsRef = useRef(null);
  const pcRef = useRef(null);
  const videoRef = useRef(null);

  // State to manage connection status and ICE servers
  const [connectionState, setConnectionState] = useState('disconnected');
  const [iceServers, setIceServers] = useState(null);

  // Configuration constants for the robot and signaling server
  const ROBOT_ID = "Concierge-729f";
  const CLIENT_AUTH_KEY = "your_secret_client_key_123"; // Replace with your actual client key
  const SIGNALING_SERVER_HOST = "dev.robohub.io"; // Your signaling server host
  const WEBRTC_CLIENT_ENDPOINT = `wss://${SIGNALING_SERVER_HOST}/concierge/v1/mandy/${ROBOT_ID}/camera/webrtc?auth_key=${CLIENT_AUTH_KEY}`;

  const createPeerConnection = (servers) => {
    console.log("Creating PeerConnection with ICE servers:", servers);

    // Initialize RTCPeerConnection with provided ICE servers
    const pc = new RTCPeerConnection({
      iceServers: servers || []
    });

    // Event handler for connection state changes (e.g., 'new', 'connecting', 'connected', 'disconnected', 'failed', 'closed')
    pc.onconnectionstatechange = () => {
      console.log("Connection State:", pc.connectionState);
      setConnectionState(pc.connectionState);
    };

    // Event handler for ICE gathering state changes (e.g., 'new', 'gathering', 'complete')
    pc.onicegatheringstatechange = () => {
      console.log("ICE Gathering State:", pc.iceGatheringState);
    };

    // Event handler for ICE connection state changes (e.g., 'new', 'checking', 'connected', 'completed', 'failed', 'disconnected', 'closed')
    pc.oniceconnectionstatechange = () => {
      console.log("ICE Connection State:", pc.iceConnectionState);
    };

    // Event handler for new ICE candidates (network configuration information)
    pc.onicecandidate = (event) => {
      console.log("New ICE candidate:", event.candidate);
      // If a candidate is found and WebSocket is open, send it to the signaling server
      if (event.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: "ice_candidate",
            data: event.candidate,
          })
        );
      }
    };

    // Event handler for receiving remote tracks (audio/video streams)
    pc.ontrack = (event) => {
      console.log("Received remote stream:", event.streams[0]);
      // Attach the received stream to the video element
      if (videoRef.current && event.streams[0]) {
        videoRef.current.srcObject = event.streams[0];
      }
    };

    return pc;
  };

  /**
   * Requests ICE (Interactive Connectivity Establishment) servers from the signaling server.
   * This is crucial for NAT traversal and establishing direct peer-to-peer connections.
   */
  const requestIceServers = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log("Requesting ICE servers from server...");
      wsRef.current.send(JSON.stringify({
        type: "ice_servers_request"
      }));
    }
  };

  /**
   * Creates an SDP (Session Description Protocol) offer and sends it to the signaling server.
   * The offer describes the client's capabilities for the WebRTC session.
   */
  const createOfferAndSend = async () => {
    const pc = pcRef.current;
    if (!pc) {
      console.error("PeerConnection not initialized");
      return;
    }

    try {
      console.log("Creating offer...");
      // Create an SDP offer to receive video (but not audio in this case)
      const offer = await pc.createOffer({
        offerToReceiveVideo: true,
        offerToReceiveAudio: false
      });

      // Set the local description with the created offer
      await pc.setLocalDescription(offer);
      console.log("Local description set, sending offer to server");

      // Send the SDP offer to the signaling server via WebSocket
      wsRef.current.send(
        JSON.stringify({
          type: "sdp",
          data: {
            sdp: offer.sdp,
            type: offer.type,
          },
        })
      );
    } catch (error) {
      console.error("Error creating or sending offer:", error);
    }
  };

  // useEffect hook for WebSocket and WebRTC setup and cleanup
  useEffect(() => {
    // Initialize WebSocket connection
    const ws = new WebSocket(WEBRTC_CLIENT_ENDPOINT);
    wsRef.current = ws;

    // WebSocket on open event: request ICE servers
    ws.onopen = async () => {
      console.log("WebSocket connected, requesting ICE servers...");
      requestIceServers();
    };

    // WebSocket on message event: handle different message types from the signaling server
    ws.onmessage = async (event) => {
      const msg = JSON.parse(event.data);
      console.log("Received message:", msg);

      if (msg.type === "ice_servers_response") {
        // Received ICE server configurations
        setIceServers(msg.iceServers);
        // Create PeerConnection with the received ICE servers
        const pc = createPeerConnection(msg.iceServers);
        pcRef.current = pc;
        // Create and send SDP offer
        await createOfferAndSend();
      } else if (msg.type === "ice_servers_error") {
        // Error in requesting ICE servers
        console.log("ICE servers request failed:", msg.error);
      } else if (msg.type === "sdp_reply") {
        // Received SDP answer from the robot
        const pc = pcRef.current;
        if (!pc) {
          console.error("PeerConnection not initialized before SDP reply.");
          return;
        }

        try {
          console.log("Received SDP answer, setting remote description");
          // Set the remote description with the received SDP answer
          await pc.setRemoteDescription(
            new RTCSessionDescription({
              type: "answer",
              sdp: msg.data.sdp,
            })
          );
          console.log("Remote description set successfully");
        } catch (error) {
          console.error("Error setting remote description:", error);
        }
      } else if (msg.type === "ice_candidate_reply") {
        // Received ICE candidate from the robot
        const pc = pcRef.current;
        if (pc && msg.data) {
          try {
            // Add the received ICE candidate to the PeerConnection
            await pc.addIceCandidate(new RTCIceCandidate(msg.data));
            console.log("Added ICE candidate from server");
          } catch (error) {
            console.error("Error adding ICE candidate:", error);
          }
        }
      }
    };

    // WebSocket on error event
    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    // WebSocket on close event
    ws.onclose = (event) => {
      console.log("WebSocket closed:", event.code, event.reason);
      setConnectionState('disconnected');
    };

    // Cleanup function: close PeerConnection and WebSocket when component unmounts
    return () => {
      console.log("Cleaning up connections...");
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setConnectionState('disconnected');
    };
  }, []); // Empty dependency array ensures this effect runs only once on mount

  /**
   * Determines the Tailwind CSS class for the connection status text color.
   * @returns {string} Tailwind CSS class.
   */
  const getConnectionStatusColor = () => {
    switch (connectionState) {
      case 'connected':
        return 'text-green-500';
      case 'connecting':
        return 'text-yellow-500';
      case 'disconnected':
        return 'text-red-500';
      case 'failed':
        return 'text-red-600';
      default:
        return 'text-gray-500';
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
      {/* Status indicator */}
      <div className="mb-4 text-center">
        <div className={`text-lg font-semibold ${getConnectionStatusColor()}`}>
          Connection: {connectionState}
        </div>
        {iceServers && (
          <div className="text-sm text-gray-600 mt-2">
            ICE Servers: {iceServers.length} configured
          </div>
        )}
      </div>

      {/* Video container */}
      <div className="relative w-full max-w-4xl">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="rounded-lg shadow-xl w-full h-auto object-contain bg-black"
          style={{ minHeight: '300px' }}
        />
        {/* Overlay for connection status when not connected */}
        {connectionState !== 'connected' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 rounded-lg">
            <div className="text-white text-center">
              <div className="animate-pulse text-lg">
                {connectionState === 'connecting' ? 'Connecting to robot camera...' : 'Waiting for connection...'}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Debug info */}
      <div className="mt-4 text-xs text-gray-500 text-center max-w-2xl">
        <div>Robot ID: {ROBOT_ID}</div>
        <div>Server: {SIGNALING_SERVER_HOST}</div>
      </div>
    </div>
  );
}
