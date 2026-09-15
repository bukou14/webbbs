
import WebSocket from 'ws';

const ws = new WebSocket('wss://term.gamer.com.tw/bbs', {
  origin: 'https://term.gamer.com.tw'
});

ws.on('open', () => {
  console.log('Connected');
});

ws.on('message', (data) => {
  // Convert Big5 to UTF-8 or just log hex to see what's happening
  console.log('Received:', data.toString('hex'));
  // I should probably use a Big5 decoder if I want to read the text
});

ws.on('error', (err) => {
  console.error('Error:', err);
});

ws.on('close', () => {
  console.log('Disconnected');
});

setTimeout(() => {
  ws.close();
}, 5000);
