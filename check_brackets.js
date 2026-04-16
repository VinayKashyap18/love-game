const fs = require('fs');
const content = fs.readFileSync('C:\\Users\\sathi\\.gemini\\antigravity\\scratch\\love-game\\frontend\\src\\App.jsx', 'utf8');

const stack = [];
const pairs = { '(': ')', '{': '}', '[': ']', '<': '>' };
const open = new Set(Object.keys(pairs));
const close = new Set(Object.values(pairs));

for (let i = 0; i < content.length; i++) {
  const char = content[i];
  if (open.has(char)) {
    stack.push({ char, i });
  } else if (close.has(char)) {
    if (stack.length === 0) {
      console.log(`Unmatched closing ${char} at index ${i}`);
    } else {
      const last = stack.pop();
      if (pairs[last.char] !== char) {
        console.log(`Mismatch: ${last.char} at ${last.i} closed by ${char} at ${i}`);
      }
    }
  }
}

if (stack.length > 0) {
  console.log('Unclosed brackets:');
  stack.forEach(s => console.log(`${s.char} at ${s.i}`));
} else {
  console.log('All brackets balanced!');
}
