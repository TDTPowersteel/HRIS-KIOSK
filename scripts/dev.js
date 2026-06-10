const { spawn } = require('child_process');
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
  
  // 1. Update Frontend backend.ts
  const tsPath = path.join(rootDir, 'src/config/backend.ts');
  const tsContent = `const IP_ADDRESS = '${ip}';\nexport const BACKEND_URL = \`http://\${IP_ADDRESS}:8000\`;\n`;
  fs.writeFileSync(tsPath, tsContent);
  console.log(`${colors.green}  [Config]${colors.reset} Updated src/config/backend.ts -> ${ip}:8000`);

  // 2. Update Backend .env
  const envPath = path.join(rootDir, 'backend-php/.env');
  if (fs.existsSync(envPath)) {
    let envLines = fs.readFileSync(envPath, 'utf8').split('\n');
    let updated = false;
    const newImsUrl = `IMS_URL=http://${ip}:8001`;
    
    envLines = envLines.map(line => {
      if (line.startsWith('IMS_URL=')) {
        updated = true;
        return newImsUrl;
      }
      return line;
    });
    
    if (!updated) envLines.push(newImsUrl);
    fs.writeFileSync(envPath, envLines.join('\n'));
    console.log(`${colors.green}  [Config]${colors.reset} Updated backend-php/.env -> IMS_URL=${ip}:8001`);
  }
}

const activeProcesses = [];

function startProcess(name, command, args, color, cwd = process.cwd()) {
  console.log(`${colors.bright}${color}  ${name.toUpperCase()}  ${colors.reset} Starting...`);
  const proc = spawn(command, args, {
    stdio: ['inherit', 'pipe', 'inherit'],
    shell: true,
    cwd
  });

  proc.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    lines.forEach(line => {
      if (line.trim()) {
        process.stdout.write(`${color}[${name}]${colors.reset} ${line}\n`);
      }
    });
  });

  activeProcesses.push(proc);
  return proc;
}

async function main() {
  console.clear();
  console.log(`\n${colors.bright}${colors.cyan}TDT-HRIS KIOSK DYNAMIC DEV ENVIRONMENT${colors.reset}\n`);
  
  const ip = getIPAddress();
  console.log(`${colors.blue}  [Network]${colors.reset} Detected IP: ${colors.bright}${ip}${colors.reset}`);
  updateConfigs(ip);
  console.log(`${colors.magenta}-------------------------------------------------${colors.reset}\n`);

  console.log(`${colors.bright}SELECT COMPONENTS TO RUN:${colors.reset}`);
  console.log(`1. Full System (Backend + Face Server + Expo)`);
  console.log(`2. Backend Only (PHP + Python Face Server)`);
  console.log(`3. PHP Backend Only [Port 8000]`);
  console.log(`4. Python Face Server Only [Port 5001]`);
  console.log(`5. Expo Android Only`);
  console.log(`6. Exit\n`);

  rl.question(`${colors.yellow}Enter your choice (1-6): ${colors.reset}`, async (choice) => {
    const rootDir = path.resolve(__dirname, '..');
    
    const runPhp = () => startProcess('php', 'php', ['-S', '0.0.0.0:8000', '-t', 'backend-php/public'], colors.bgBlue, rootDir);
    const runPython = () => startProcess('face', '.venv\\Scripts\\python.exe', ['app.py'], colors.magenta, path.join(rootDir, 'intern_face_reg_server'));
    const runExpo = () => {
      rl.question(`\n${colors.cyan}EXPO OPTIONS:${colors.reset}\n1. Standard Launch\n2. Device Selection (--device)\nChoice: `, (expoChoice) => {
        const args = ['expo', 'run:android'];
        if (expoChoice === '2') args.push('--device');
        startProcess('expo', 'npx', args, colors.bgGreen, rootDir);
      });
    };

    switch(choice) {
      case '1':
        runPhp();
        runPython();
        setTimeout(runExpo, 1000);
        break;
      case '2':
        runPhp();
        runPython();
        break;
      case '3':
        runPhp();
        break;
      case '4':
        runPython();
        break;
      case '5':
        runExpo();
        break;
      case '6':
        process.exit();
        break;
      default:
        console.log(`${colors.red}Invalid choice.${colors.reset}`);
        process.exit();
    }
  });
}

process.on('SIGINT', () => {
  console.log(`\n\n${colors.bright}${colors.yellow}Shutting down all servers...${colors.reset}`);
  activeProcesses.forEach(p => p.kill());
  process.exit();
});

main();
