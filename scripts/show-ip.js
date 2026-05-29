const os = require('os');
const interfaces = os.networkInterfaces();
console.log('\n局域网访问地址：');
for (const name of Object.keys(interfaces)) {
  for (const iface of interfaces[name]) {
    if (iface.family === 'IPv4' && !iface.internal) {
      console.log(`   http://${iface.address}:3000`);
    }
  }
}
console.log('');
