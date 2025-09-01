// src/App.js
import React from 'react';
import WebRTCClient from './WebRTCClient'; // Adjust path if needed

function App() {
  return (
    <div className="App">
      <header className="App-header">
        <h1>WebRTC Camera Stream Viewer</h1>
      </header>
      <main>
        <WebRTCClient />
      </main>
    </div>
  );
}

export default App;