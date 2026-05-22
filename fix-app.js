const fs = require('fs');
const file = 'D:/SmartPrint_final/student web app/client/src/App.tsx';
let content = fs.readFileSync(file, 'utf8');
content = content.replace(/import BatchStatus from "\.\/pages\/batch-status";/g, '');
content = content.replace(/<Route path="\/batch-status" component={BatchStatus} \/>/g, '');
fs.writeFileSync(file, content);
console.log('Fixed App.tsx');
