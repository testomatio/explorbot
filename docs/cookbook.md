# Cookbook

Short recipes for common tasks.

## Predefined Login

Skip LLM guessing and keep credentials secure by creating a custom `I.login()` step.

| Without | With |
|---------|------|
| Credentials sent to LLM | Credentials stay in env vars |
| LLM guesses form locators | Reliable hardcoded locators |
| Multiple API calls per login | Single function call |

### Setup

**1. Create `steps_file.js`:**

```javascript
export default function() {
  return actor({
    login() {
      this.fillField('Email', process.env.TEST_EMAIL);
      this.fillField('Password', process.env.TEST_PASSWORD);
      this.click('Sign In');
      this.waitForElement('.dashboard', 10);
    }
  });
}
```

**2. Add to config:**

```javascript
// explorbot.config.js
export default {
  stepsFile: './steps_file.js',
  // ... rest of config
};
```

**3. Create `knowledge/login.md`:**

```markdown
---
url: /login
---

This page requires authentication.
Use I.login() for login. Do not fill email/password fields manually.
The I.login() function handles all authentication automatically.
```

**4. Set credentials in `.env`:**

```bash
TEST_EMAIL=admin@example.com
TEST_PASSWORD=secret123
```

### Multiple Roles

```javascript
export default function() {
  return actor({
    login(role = 'user') {
      const creds = {
        admin: { email: process.env.ADMIN_EMAIL, pass: process.env.ADMIN_PASSWORD },
        user: { email: process.env.USER_EMAIL, pass: process.env.USER_PASSWORD },
      };
      const { email, pass } = creds[role] || creds.user;

      this.fillField('Email', email);
      this.fillField('Password', pass);
      this.click('Sign In');
      this.waitForElement('.dashboard', 10);
    },

    loginAsAdmin() {
      this.login('admin');
    },
  });
}
```

Knowledge file:

```markdown
---
url: /login
---

Use these steps for authentication (do not fill credentials manually):
- I.login() - login as default user
- I.loginAsAdmin() - login as admin
```

### With 2FA

```javascript
login() {
  this.fillField('Email', process.env.TEST_EMAIL);
  this.fillField('Password', process.env.TEST_PASSWORD);
  this.click('Sign In');
  this.waitForElement('.two-factor-input', 5);
  this.fillField('.two-factor-input', process.env.TEST_2FA_CODE);
  this.click('Verify');
  this.waitForElement('.dashboard', 10);
}
```

### Troubleshooting

**Step not recognized** — Ensure file exports a function returning `actor({...})`:

```javascript
// Correct
export default function() {
  return actor({ login() { ... } });
}
```

**Navigator still fills credentials manually** — Make knowledge instruction more explicit:

```markdown
---
url: /login
---

IMPORTANT: Use I.login() for authentication.
Do NOT fill email or password fields manually.
```

If knowledge alone doesn't work, add system prompt as fallback:

```javascript
ai: {
  agents: {
    navigator: {
      systemPrompt: `When login is required, use I.login(). Never fill credentials manually.`,
    },
  },
},
```
