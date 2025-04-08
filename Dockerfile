# Imagen base con Puppeteer y Chromium ya instalados
FROM ghcr.io/puppeteer/puppeteer:latest

# Establecer el directorio de trabajo
WORKDIR /app

# Copiar package.json y package-lock.json (si lo tenés)
COPY package*.json ./

# Instalar dependencias (ya hay node y npm en la imagen base)
RUN npm install

# Copiar el resto del código
COPY . .

# Exponer el puerto
EXPOSE 3000

# Comando para ejecutar la app
CMD ["npm", "start"]
