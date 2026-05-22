const fs = require('fs');
const path = 'd:/smartprintvit/student web app/client/src/pages/print-wizard.tsx';
let content = fs.readFileSync(path, 'utf8');

const regex = /<div className="mb-8 max-w-sm mx-auto">[\s\S]*?<label className="block text-sm font-semibold mb-2 text-left">Your Name<\/label>[\s\S]*?<input[\s\S]*?placeholder="Enter your name"[\s\S]*?value=\{studentName\}[\s\S]*?onChange=\{\(e\) => setStudentName\(e\.target\.value\)\}[\s\S]*?className="w-full px-4 py-3 rounded-xl border border-border bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary shadow-sm"[\s\S]*?\/>\s*<\/div>/g;

const replacement = `{!(typeof window !== 'undefined' && (localStorage.getItem("teacherName") || localStorage.getItem("adminAuth"))) && (
                  <div className="mb-8 max-w-sm mx-auto">
                    <label className="block text-sm font-semibold mb-2 text-left">Your Name</label>
                    <input
                      type="text"
                      placeholder="Enter your name"
                      value={studentName}
                      onChange={(e) => setStudentName(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-border bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary shadow-sm"
                    />
                  </div>
                  )}`;

if (regex.test(content)) {
    content = content.replace(regex, replacement);
    fs.writeFileSync(path, content);
    console.log("Success");
} else {
    console.log("Target not found with regex");
}
