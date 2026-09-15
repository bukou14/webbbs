
import WebSocket from 'ws';
import iconv from 'iconv-lite';

const ws = new WebSocket('wss://term.gamer.com.tw/bbs', {
  origin: 'https://term.gamer.com.tw'
});

let buffer = Buffer.alloc(0);
let state = 'LOGIN_ID';

ws.on('open', () => {
  console.log('Connected');
});

ws.on('message', (data) => {
  buffer = Buffer.concat([buffer, data]);
  const text = iconv.decode(buffer, 'big5');
  console.log('--- Received chunk ---');
  console.log(text);
  
  if (state === 'LOGIN_ID' && text.includes('請輸入勇者代號')) {
    console.log('Sending Username...');
    ws.send((process.env.BBS_USER || '') + '\r');
    state = 'LOGIN_PW';
  } else if (state === 'LOGIN_PW' && text.includes('請輸入密碼')) {
    console.log('Sending Password...');
    ws.send((process.env.BBS_PASS || '') + '\r');
    state = 'DISMISS_NOTICE';
  } else if (state === 'DISMISS_NOTICE' && text.includes('您要刪除其他重複登入的連線嗎')) {
    console.log('Handling duplicate login...');
    ws.send('n\r');
  } else if (state === 'DISMISS_NOTICE' && text.includes('請按任意鍵繼續')) {
    console.log('Dismissing notice...');
    ws.send('\r');
  } else if (state === 'DISMISS_NOTICE' && text.includes('【 主選單 】')) {
      console.log('At Main Menu. Navigating to Chat board...');
      ws.send('sChat\r');
      state = 'IN_BOARD_SPLASH';
  } else if (state === 'IN_BOARD_SPLASH' && (text.includes('文章選單') || text.includes('看板《Chat》'))) {
      console.log('At Board Post List. Testing #100...');
      ws.send('\r');
      setTimeout(() => {
          console.log('Sending #100...');
          ws.send('#');
          setTimeout(() => ws.send('100\r'), 500);
      }, 1000);
      state = 'VERIFY_JUMP';
  } else if (state === 'VERIFY_JUMP') {
      if (text.includes('100')) {
          console.log('Screen updated. Content around "100":');
          const start = Math.max(0, text.indexOf('100') - 40);
          const end = Math.min(text.length, text.indexOf('100') + 100);
          console.log(text.substring(start, end));
      }
  }
});

ws.on('error', (err) => {
  console.error('Error:', err);
});

ws.on('close', () => {
  console.log('Disconnected');
});

setTimeout(() => {
  console.log('Timeout reached. Closing.');
  ws.close();
}, 30000);
