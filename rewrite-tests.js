const fs = require('fs');
const path = require('path');
const glob = require('glob');

// We use glob inside node to find all test files
const testFiles = glob.sync('tests/**/*.test.js', { cwd: __dirname });

testFiles.forEach(file => {
    const fullPath = path.join(__dirname, file);
    let content = fs.readFileSync(fullPath, 'utf8');
    
    // Replace .get('/wallets'), .post('/donations'), etc. with /api/v1 prefix
    let newContent = content.replace(/\.(get|post|put|patch|delete)\('\/(wallets|donations|stats|stream|transactions|api-keys)([^']*)'/g, 
        (match, method, route, rest) => {
            return `.${method}('/api/v1/${route}${rest}'`;
        }
    );

    // Also replace double quotes
    newContent = newContent.replace(/\.(get|post|put|patch|delete)\("\/(wallets|donations|stats|stream|transactions|api-keys)([^"]*)"/g, 
        (match, method, route, rest) => {
            return `.${method}("/api/v1/${route}${rest}"`;
        }
    );

    // Replace template literals without expressions inside simple paths
    newContent = newContent.replace(/\.(get|post|put|patch|delete)\(`\/(wallets|donations|stats|stream|transactions|api-keys)([^`]*?)`/g, 
        (match, method, route, rest) => {
            return `.${method}(\`/api/v1/${route}${rest}\``;
        }
    );

    // Requesting directly via supertest wrapped paths like request(app).post('/wallets')

    if (content !== newContent) {
        fs.writeFileSync(fullPath, newContent, 'utf8');
        console.log(`Updated ${file}`);
    }
});
