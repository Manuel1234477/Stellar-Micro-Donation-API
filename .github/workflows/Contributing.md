🛠️ Getting Started for Contributors

Code Style & Comments
We maintain a strict "Explain the Why" policy. When adding or editing services, ensure you:

Comment Complex Math: Explain the rounding strategy for currency conversions.

Document Edge Cases: What happens if a payment fails halfway through a multi-charity split?

Reference Business Logic: If a constant (like MIN_THRESHOLD) exists, comment on the financial reasoning behind that specific number.

Installation
Bash
# Clone the repository
git clone https://github.com/your-repo/micro-donation-api.git

# Install dependencies
npm install  # or pip install -r requirements.txt

# Set up environment variables
cp .env.example .env
📊 Acceptance Criteria for Pull Requests
Before submitting a PR, ensure:

[ ] Readability: Inline comments explain the "Why" behind complex logic.

[ ] Stability: No functional changes to core aggregation math unless explicitly requested.

[ ] Testing: All precision-math tests pass (no rounding errors > $0.0001).

⚖️ License
This project is licensed under the MIT License - see the LICENSE file for details.