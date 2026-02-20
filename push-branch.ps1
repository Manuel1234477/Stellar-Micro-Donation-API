# PowerShell script to push the branch
# Run this in a NEW terminal window

# Set remote to HTTPS
git remote set-url origin https://github.com/Manuel1234477/Stellar-Micro-Donation-API.git

# Show current branch
Write-Host "Current branch:" -ForegroundColor Green
git branch --show-current

# Show commit
Write-Host "`nLast commit:" -ForegroundColor Green
git log --oneline -1

# Push the branch
Write-Host "`nPushing to GitHub..." -ForegroundColor Yellow
git push -u origin feature/analytics-fee-calculation

Write-Host "`nBranch pushed successfully!" -ForegroundColor Green
Write-Host "Next: Go to GitHub and create a Pull Request" -ForegroundColor Cyan
Write-Host "URL: https://github.com/Manuel1234477/Stellar-Micro-Donation-API/pulls" -ForegroundColor Cyan
