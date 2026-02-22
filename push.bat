@echo off
echo yes | git -c core.sshCommand="ssh -o StrictHostKeyChecking=no" push -u origin feature/analytics-fee-calculation
