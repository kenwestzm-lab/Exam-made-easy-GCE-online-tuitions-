const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });

wss.on('connection', (ws) => {
    console.log('Client connected for audio streaming');

    ws.on('message', (message) => {
        // Handle incoming audio data chunks here
    });

    ws.on('close', () => {
        console.log('Client disconnected');
    });
});
