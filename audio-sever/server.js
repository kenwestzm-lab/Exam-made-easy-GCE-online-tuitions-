const record = require('node-record-lpcm16');
const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });

wss.on('connection', (ws) => {
    console.log('Client connected for audio streaming');
    const recording = record.record({
        sampleRate: 16000,
        threshold: 0
    });

    recording.stream().on('data', (chunk) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(chunk);
        }
    });

    ws.on('close', () => {
        recording.stop();
        console.log('Client disconnected');
    });
});
