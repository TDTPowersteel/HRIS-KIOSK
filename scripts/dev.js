const { spawn, execSync } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ANSI Color Codes
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgBlue: "\x1b[44m",
  bgGreen: "\x1b[42m"
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function getIPAddress() {
  const interfaces = os.networkInterfaces();
  let fallbackIP = null;

  for (const devName in interfaces) {
    const iface = interfaces[devName];
    const name = devName.toLowerCase();
    const isWifi = name.includes('wi-fi') || name.includes('wireless') || name.includes('wlan') || name.includes('ethernet');

    for (let i = 0; i < iface.length; i++) {
      const alias = iface[i];
      if (alias.family === 'IPv4' && !alias.internal) {
        if (isWifi) return alias.address;
        if (!fallbackIP) fallbackIP = alias.address;
      }
    }
  }
  return fallbackIP || '127.0.0.1';
}

function updateConfigs(ip) {
  const rootDir = path.join(__dirname, '..');
  
  // Update Backend .env
  const envPath = path.join(rootDir, 'backend-php/.env');
  if (fs.existsSync(envPath)) {
    let envLines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    let imsUpdated = false;
    let ipUpdated = false;
    const newImsUrl = `IMS_URL=http://${ip}:8001`;
    const newIpLine = `EXPO_PUBLIC_BACKEND_IP=${ip}`;
    
    envLines = envLines.map(line => {
      const trimmed = line.trim();
      if (trimmed.startsWith('IMS_URL=')) {
        imsUpdated = true;
        return newImsUrl;
      }
      if (trimmed.startsWith('EXPO_PUBLIC_BACKEND_IP=')) {
        ipUpdated = true;
        return newIpLine;
      }
      return line;
    });
    
    if (!imsUpdated) envLines.push(newImsUrl);
    if (!ipUpdated) envLines.push(newIpLine);
    fs.writeFileSync(envPath, envLines.join('\n'));
    console.log(`${colors.green}  [Config]${colors.reset} Updated backend-php/.env -> IMS_URL=${ip}:8001 & EXPO_PUBLIC_BACKEND_IP=${ip}`);
  }
}

const activeProcesses = [];

function startProcess(name, command, args, color, cwd = process.cwd(), customStdio = null) {
  console.log(`${colors.bright}${color}  ${name.toUpperCase()}  ${colors.reset} Starting...`);
  
  const customEnv = { ...process.env };
  const rootDir = path.resolve(__dirname, '..');
  const envPath = path.join(rootDir, 'backend-php/.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    lines.forEach(line => {
      const trimmed = line.trim();
      if (trimmed.startsWith('EXPO_PUBLIC_')) {
        const parts = trimmed.split('=', 2);
        if (parts.length === 2) {
          customEnv[parts[0].trim()] = parts[1].trim();
        }
      }
    });
  }

  const proc = spawn(command, args, {
    stdio: customStdio || ['inherit', 'pipe', 'inherit'],
    shell: true,
    cwd,
    env: customEnv
  });

  if (proc.stdout) {
    proc.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      lines.forEach(line => {
        if (line.trim()) {
          process.stdout.write(`${color}[${name}]${colors.reset} ${line}\n`);
        }
      });
    });
  }

  activeProcesses.push(proc);
  return proc;
}

async function main() {
  console.clear();
  console.log(`\n${colors.bright}${colors.cyan}TDT-HRIS KIOSK DYNAMIC DEV ENVIRONMENT${colors.reset}\n`);
  
  const ip = getIPAddress();
  console.log(`${colors.blue}  [Network]${colors.reset} Detected IP: ${colors.bright}${ip}${colors.reset}`);
  updateConfigs(ip);
  console.log(`${colors.cyan}-------------------------------------------------${colors.reset}\n`);

  console.log(`${colors.bright}SELECT COMPONENTS TO RUN:${colors.reset}`);
  console.log(`1. Full System (Backend + Face Server + Expo)`);
  console.log(`2. Backend Only (PHP + Python Face Server)`);
  console.log(`3. PHP Backend Only [Port 8000]`);
  console.log(`4. Python Face Server Only [Port 5001]`);
  console.log(`5. Expo Android Only`);
  console.log(`6. Exit\n`);

  rl.question(`${colors.yellow}Enter your choice (1-6): ${colors.reset}`, async (choice) => {
    const rootDir = path.resolve(__dirname, '..');
    
    const isWindows = process.platform === 'win32';
    const pythonBin = isWindows 
      ? path.join(rootDir, 'face_server', '.venv', 'Scripts', 'python.exe') 
      : path.join(rootDir, 'face_server', '.venv', 'bin', 'python');
    
    const runPhp = () => startProcess('php', 'php', ['-S', '0.0.0.0:8000', '-t', 'backend-php/public'], colors.bgBlue, rootDir);
    const runPython = () => startProcess('face-server'.toUpperCase(), pythonBin, ['-u', 'app.py'], colors.magenta, path.join(rootDir, 'face_server'));
    const runExpo = () => {
      let dots = 0;
      process.stdout.write(`\n${colors.yellow}Please wait, downloading and initializing build environment `);
      const interval = setInterval(() => {
        dots = (dots + 1) % 4;
        process.stdout.write('\r\x1b[K'); // clear line
        process.stdout.write(`${colors.yellow}Please wait, downloading and initializing build environment ${'.'.repeat(dots)}${colors.reset}`);
      }, 500);

      setTimeout(() => {
        clearInterval(interval);
        process.stdout.write('\r\x1b[K'); // clear line
        console.log(`${colors.green}Done! Environment ready.${colors.reset}`);
        
        rl.question(`\n${colors.cyan}EXPO OPTIONS:${colors.reset}\n1. Standard Launch\n2. Device Selection (--device)\nChoice: `, (expoChoice) => {
          rl.close();
          const args = ['expo', 'run:android'];
          if (expoChoice === '2') args.push('--device');
          startProcess('expo', 'npx', args, colors.bgGreen, rootDir, 'inherit');
        });
      }, 2500); // 2.5 seconds loading animation
    };

    switch(choice) {
      case '1':
        runPhp();
        runPython();
        setTimeout(runExpo, 1000);
        break;
      case '2':
        rl.close();
        runPhp();
        runPython();
        break;
      case '3':
        rl.close();
        runPhp();
        break;
      case '4':
        rl.close();
        runPython();
        break;
      case '5':
        runExpo();
        break;
      case '6':
        rl.close();
        process.exit();
        break;
      default:
        console.log(`${colors.red}Invalid choice.${colors.reset}`);
        rl.close();
        process.exit();
    }
  });
}

process.on('SIGINT', () => {
  console.log(`\n\n${colors.bright}${colors.yellow}Shutting down all servers...${colors.reset}`);
  activeProcesses.forEach(p => {
    if (process.platform === 'win32') {
      try {
        execSync(`taskkill /pid ${p.pid} /t /f`, { stdio: 'ignore' });
      } catch (e) {
        p.kill();
      }
    } else {
      p.kill();
    }
  });
  process.exit();
});

main();
