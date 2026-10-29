FROM node:20-alpine

# Instalar dependências necessárias para compilar pacotes nativos como o sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm", "start"]