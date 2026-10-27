FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p /app/data /app/public/uploads
EXPOSE 3000
CMD ["npm", "start"]
