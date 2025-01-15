# Expression Wrangler

This is a lightweight proof-of-concept tool for wrangling JSON from a REST API and performing analysis using OpenAI's GPT-4 model.

## Requirements

- [Docker](https://www.docker.com/) installed on your system
- OpenAI API key

## Getting Started

### 1. Build the Docker Image

To build the Docker image, use the following command:

```bash
docker build -t expression-wrangler .
```

### 2. Run the Container

To start a container from the image without running any specific command:

```bash
docker run -it --rm --name expression-wrangler expression-wrangler
```

This will start the container and drop you into an interactive shell.

### 3. Access the Container

If the container is already running but you need a new shell:

```bash
docker exec -it expression-wrangler sh
```

### 4. Setting Environment Variables

The application uses an OpenAI API key, which can be provided as an environment variable (or in a `.env` file) when starting the container:

```bash
docker run -it --rm --name expression-wrangler -e OPENAI_API_KEY=your_openai_api_key expression-wrangler
```

### 5. Debugging or Interactive Use

To explore or debug, start the container interactively without running the main script:

```bash
docker run -it --rm expression-wrangler sh
```

You can then manually run the script or explore the container's environment.

## Notes

- Ensure your `.env` file is included during development, but avoid adding sensitive information directly into the image.
- The Dockerfile does not run `index.js` automatically. You can modify it if needed for production scenarios.
