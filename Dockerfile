FROM node:18-alpine

# Install git needed by the git-rev-sync npm module
RUN apk add --no-cache git

# make the work dir
WORKDIR /app

# copy the sources etc in
COPY . .

# install the node dependencies
RUN yarn install

# compile the TypeScipt
RUN yarn build
