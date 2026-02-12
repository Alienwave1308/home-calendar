# Используем официальный образ Node.js версии 20
FROM node:20-alpine

# Устанавливаем рабочую директорию внутри контейнера
WORKDIR /app

# Копируем package.json и package-lock.json
COPY package*.json ./

# Устанавливаем зависимости
RUN npm install --production

# Копируем весь код приложения
COPY . .

# Открываем порт 3000
EXPOSE 3000

# Команда для запуска приложения
CMD ["node", "backend/server.js"]


