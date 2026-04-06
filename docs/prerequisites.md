# Application prerequisites

Explorbot is meant for CRUD intensive web applications:

- SaaS platforms
- ecommerce
- ERP
- admin panels
- internal tools
- anything CRUD-heavy

Not a great match for landing sites, blogs, CMS or static websites.

## Page Management

Explorbot uses URLs as anchor points when navigating websites. Each change in URL, `title`, `h1`-`h4` results a new state. This helps Explobot to understand the change and analyze transition.

If your application doesn't change URL on navigation, nor uses correctly `title`, `h1`-`h4` it hardens navigation.

It is recommended application to correctly use URLs to identify application states.

Edge cases and domain rules must be set to [Knowledge files](knowledge.md) which are attached to page URLs.

## Web Elements

Explorbot uses HTML+ARIA+VIsual identification which helps to solve most of issues if only one strategy is used. 

It is recommened for application to not use long scrolls as it hardens visual identification of elements.

ARIA attributes are used widely, but explorbot can fallback to HTML when ARIA elements are empty. So its' ok to have in ARIA tree elements like this:

```
- role: button
  text:
```

However, using of A11y standards accross website improves quality of Explorbot's interaction. It will make less fail attempts on common elements.

## Data Management

It is recommended to launch Explorbot to **isolated workspace** of your application. It can be a separate project inside app, staging environment, etc. It is recommended to **pre-populate initial data** so Explorbot would easily understand applicatoin's purpose and interact with it more effectively. It needs additional correct data to understand the business domain and propose more meaningful tests. 

Explorbot can potentially change or delete data items from web interface. It is your responsibility to ensure you can quickly load this data back in case environment was broken.

To simplify:

- prepare a dataset for pages where Explorbot will interact to help it quicker understand application
- ensure the data is not critical and can be quickly restored in case of accidental deletion

## Security

It is your responsibility to provide Explorbot an isolated environment which will never affect a production data.

Explorbot uses a user session with predefined credentials. Ensure that this user have a limited set of permissions and can't harm data in that environment.

It is recommended not to use sensitive data in your envirnonement. Credit cards, tokens, passwords, can not be protected, so ensure you are using the fake ones during explorbot sessions.

Explorbot have a very limited set of privileges. **Explorbot can not**

- read or write local files (except for Caprain agent and only for knowledge/ experience/ output/ folders)
- fetch contents from external websites (it is limited to navigation over configured site)
- access Bash other CLI tools like `git` or `rm -rf` (except for Captain for limited scope of actions)

**Explorbot is not smart agent** so it can't harm system by its own on its own. It follows a predefined script of actions and only follows the plan. Its primary interactions are web and api requests, which you should restrict.

**Explorbot is recommended to run on local/dev/staging environments**. It is still possible to run Explorbot on production for regression testng ensuring its user won't have wide access and can interact only on a single project or workspace.

