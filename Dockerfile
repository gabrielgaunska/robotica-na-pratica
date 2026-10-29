FROM node:20

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p /app/data /app/public/uploads

EXPOSE 3000

CMD ["npm", "start"]
