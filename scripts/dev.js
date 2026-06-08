const { spawn } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

// ANSI Color Codes
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgBlue: "\x1b[44m",
  bgGreen: "\x1b[42m"
};

function getIPAddress() {
  const interfaces = os.networkInterfaces();
  let fallbackIP = null;

  for (const devName in interfaces) {
    const iface = interfaces[devName];
    const isWifi = devName.toLowerCase().includes('wi-fi') || 
                   devName.toLowerCase().includes('wireless') || 
                   devName.toLowerCase().includes('wlan');

    for (let i = 0; i < iface.length; i++) {
      const alias = iface[i];
      if (alias.family === 'IPv4' && !alias.internal) {
        if (isWifi) {
          return alias.address;
        }
        if (!fallbackIP) {
          fallbackIP = alias.address;
        }
      }
    }
  }
  
  return fallbackIP || '127.0.0.1';
}

function updateBackendConfig(ip) {
  const configDir = path.join(__dirname, '../src/config');
  const configPath = path.join(configDir, 'backend.ts');
  const port = 8000;

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  let content = '';
  if (fs.existsSync(configPath)) {
    content = fs.readFileSync(configPath, 'utf8');
    
    if (content.includes('const IP_ADDRESS =')) {
      content = content.replace(/const IP_ADDRESS = ['"].*?['"];/, `const IP_ADDRESS = '${ip}';`);
      content = content.replace(/export const BACKEND_URL = [`'"].*?[`'"];/, `export const BACKEND_URL = \`http://\${IP_ADDRESS}:${port}\`;`);
    } else {
      const lines = content.split('\n');
      const newLines = [];
      let foundActiveUrl = false;

      for (const line of lines) {
        if (line.trim().startsWith('// export const BACKEND_URL')) {
          newLines.push(line);
        } else if (line.trim().startsWith('export const BACKEND_URL') && !foundActiveUrl) {
          newLines.push(`const IP_ADDRESS = '${ip}';`);
          newLines.push(`export const BACKEND_URL = \`http://\${IP_ADDRESS}:${port}\`;`);
          foundActiveUrl = true;
        } else if (line.trim() || line === '') {
          newLines.push(line);
        }
      }

      if (!foundActiveUrl) {
        newLines.unshift(`const IP_ADDRESS = '${ip}';`);
        newLines.push(`export const BACKEND_URL = \`http://\${IP_ADDRESS}:${port}\`;`);
      }
      content = newLines.join('\n');
    }
  } else {
    content = `// export const BACKEND_URL = 'https://hris-backend-oav4.onrender.com';\nconst IP_ADDRESS = '${ip}';\nexport const BACKEND_URL = \`http://\${IP_ADDRESS}:${port}\`;\n`;
  }

  fs.writeFileSync(configPath, content);
}

function startDev() {
  const ip = getIPAddress();
  const port = 8000;
  const rootDir = path.resolve(__dirname, '..');

  console.log(`\n${colors.bright}${colors.green}Verification Successful${colors.reset}`);
  console.log(`${colors.blue}  [Network]${colors.reset} Detected IP: ${colors.bright}${ip}${colors.reset}`);
  console.log(`${colors.blue}  [Config] ${colors.reset} Updating src/config/backend.ts with IP_ADDRESS\n`);

  updateBackendConfig(ip);

  console.log(`${colors.magenta}-------------------------------------------------${colors.reset}`);
  
  // PHP SERVER: No shell, direct array of arguments to match manual execution exactly
  console.log(`${colors.bright}${colors.bgBlue}  PHP BACKEND  ${colors.reset} Starting on 0.0.0.0:${port}...`);
  const publicPath = path.join('backend-php', 'public');
  
  const php = spawn('php', ['-S', `0.0.0.0:${port}`, '-t', publicPath], {
    stdio: 'inherit',
    cwd: rootDir,
    env: process.env
  });

  // EXPO: Keep shell for npx convenience
  console.log(`${colors.bright}${colors.bgGreen}  EXPO ANDROID ${colors.reset} Building and launching...`);
  console.log(`${colors.magenta}-------------------------------------------------${colors.reset}\n`);
  
  const expo = spawn('npx', ['expo', 'run:android'], {
    stdio: 'inherit',
    shell: true,
    cwd: rootDir,
    env: process.env
  });

  process.on('SIGINT', () => {
    console.log(`\n\n${colors.bright}${colors.yellow}Shutting down development servers...${colors.reset}`);
    php.kill();
    expo.kill();
    process.exit();
  });

  // Handle errors if commands fail to start
  php.on('error', (err) => {
    console.error(`\n${colors.bright}${colors.white}\x1b[41m  ERROR  \x1b[0m Failed to start PHP server: ${err.message}`);
  });
  
  expo.on('error', (err) => {
    console.error(`\n${colors.bright}${colors.white}\x1b[41m  ERROR  \x1b[0m Failed to start Expo: ${err.message}`);
  });
}

console.log(`\n${colors.bright}${colors.cyan}HRIS Kiosk Development Environment${colors.reset}\n`);
process.stdout.write(`${colors.bright}${colors.yellow}Did you connect your mobile/tablet phone or run android studio tablet? y or n: ${colors.reset}`);

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding('utf8');

process.stdin.on('data', (key) => {
  if (key === '\u0003') {
    process.exit();
  }

  const answer = key.toLowerCase();
  
  if (answer === 'y') {
    process.stdout.write('y\n');
    process.stdin.setRawMode(false);
    process.stdin.pause();
    startDev();
  } else if (answer === 'n') {
    process.stdout.write('n\n');
    console.log(`\n${colors.bright}${colors.yellow}Dev script cancelled. Please connect a device first.${colors.reset}\n`);
    process.exit();
  }
});
