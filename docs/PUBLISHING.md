# Publishing

In order to run the `npm run publish` command the following environment variables need to be set:

```shell
export MOZILLA_API_KEY=...
export MOZILLA_API_SECRET=...
```

Additionally the environment should have no staged or uncommitted changes, as publishing will switch the branch to `dist` and back to `main` when done.
