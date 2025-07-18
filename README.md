# Expression Shepherd

This is a lightweight proof-of-concept tool for summarising the expression data on a gene page using OpenAI's GPT-4o model or Anthropic's Claude 4 Sonnet.

## Non-Docker usage

### 0. Requirements

- API key for your chosen model:
  - OpenAI: add `OPENAI_API_KEY=xxxxxxxxxxxxx` to a file called `.env` in this directory
  - Anthropic: add `ANTHROPIC_API_KEY=xxxxxxxxxxxxx` to a file called `.env` in this directory
- volta if possible: https://docs.volta.sh/guide/getting-started
  - it takes care of your node and yarn versions
- node - 18.20.5 tested (higher versions will likely work) 
- yarn - 1.22.19 tested

### 1. Initialise the Node.js environment

```bash
yarn
```

If you have `volta` installed, this will also make sure you have the right versions of `node` and `yarn`, otherwise you'll need to install those manually if you run into any issues.

### 2. Compile the TypeScript

```bash
yarn build
```

This compiles `src/main.ts` into `dist/main.js`

### 3. Run the code

You can run the script with any PlasmoDB gene ID:

**With OpenAI GPT-4o (default):**
```bash
node dist/main.js PF3D7_1016300
```

**With Claude 4 Sonnet:**
```bash
node dist/main.js PF3D7_1016300 --claude
```

**Note:** Use `node dist/main.js` directly instead of `yarn start` when using the `--claude` flag, as npm/yarn scripts don't pass through additional arguments.

It will output three files in the `example-output` directory:

1. `GENE_ID.01.MODEL.summaries.json` - the per experiment AI summaries (JSON)
2. `GENE_ID.01.MODEL.summary.json` - the AI summary-of-summaries and grouping (JSON)  
3. `GENE_ID.01.MODEL.summary.html` - a nice HTML version of the summary

Where `MODEL` is either `OpenAI` or `Claude` depending on which API you used.

To view the HTML open it as a local file in your web browser (Ctrl-O usually).

You can commit any generated files to the repo if you like (within reason)!

## Docker usage
### 0. Requirements

- OpenAI API key
  - add `OPENAI_API_KEY=xxxxxxxxxxxxx` to a file called `.env` in this directory
- [Docker](https://www.docker.com/) installed on your system

### 1. Build the Docker image

To build the Docker image, use the following command:

```bash
docker build -t expression-shepherd .
```

### 2. Run the container

To start a container from the image and get a shell.

The command below "mounts" ./example-output inside the container so any outputs will be seen in the host filesystem too.

```bash
docker run -d --rm --env-file .env -v $(pwd)/example-output:/app/example-output expression-shepherd sh
```
The container will be removed when you exit the shell. (But not the image.)

### 3. Run the code

If the container is already running but you need a new shell:

```bash
docker ps
# find the CONTAINER_ID
docker exec -it --env-file .env <CONTAINER_ID> sh
```

You can then manually run the script (see step 3. in the non-Docker section above):

```bash
yarn start PF3D7_0818900
```

Or you can just run the script at container launch time: 

```bash
docker run -d --rm --env-file .env -v $(pwd)/example-output:/app/example-output expression-shepherd yarn start PF3D7_0818900
```

Or like this in an already running container:

```bash
docker exec -it --env-file .env <CONTAINER_ID> yarn start PF3D7_0818900
```

Note that volta is not available in the node container but it does have suitable versions of node and yarn installed anyway.
