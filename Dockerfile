# Use Node.js LTS
FROM node:18

# Set working directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy the rest of the code INCLUDING views/
COPY . .

# Expose the port
EXPOSE 3000

# Start app
CMD ["node", "index.js"]
