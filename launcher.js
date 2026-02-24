const { spawn } = require('child_process');

function startBot() {
  console.log('====================================');
  console.log('[Launcher] Запускаем Lyaris Client...');
  console.log('====================================');
  
  // Запускаем бота через npx tsx
  const botProcess = spawn('npx', ['tsx', './src/index.ts'], { stdio: 'inherit' });

  botProcess.on('close', (code) => {
    console.log(`[Launcher] Бот отключился (код ${code}).`);
    console.log(`[Launcher] ⏳ Ждем 10 секунд перед перезапуском, чтобы опасность исчезла...`);
    
    // Ровно 10 000 миллисекунд (10 секунд)
    setTimeout(() => {
      console.log('[Launcher] Время вышло. Перезапускаю...');
      startBot();
    }, 10000); 
  });
}

startBot();