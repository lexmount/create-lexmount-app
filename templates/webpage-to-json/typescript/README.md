# {{PROJECT_NAME}}

Generated from the Lexmount `webpage-to-json` TypeScript template.

Use this template when you only need structured content from a public webpage.
It calls Lexmount WebFetch directly and does not create a Browser Session or
install Playwright. Use a Browser Session instead when the task needs clicks,
form input, or login.

## Credentials

`create-lexmount-app` writes the selected Lexmount API key, project ID, and API
base URL to this project's ignored `.env` file. If you generated with
`--no-auth`, copy `.env.example` to `.env` and fill in the credentials.

## Extract a webpage

```bash
npm run extract -- --url https://cn.vuejs.org/guide/introduction
```

The default target is Vue's public Chinese introduction guide. Its headings,
main text, links, and metadata make the structured WebFetch result immediately
useful while keeping the example credential-free.

You may instead set `TARGET_URL` in `.env` and run `npm run extract` without a
flag.

The command sends one `POST /v1/extract` request and prints structured JSON to
standard output. The output includes the page title, description, main text,
links, images, final URL, status code, extraction engine, and timing metadata
when those fields are available.

## Validate the generated project

```bash
npm run typecheck
```
