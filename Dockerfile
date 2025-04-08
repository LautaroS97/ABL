FROM ghcr.io/puppeteer/puppeteer:latest

WORKDIR /app

# Copiar los archivos primero
COPY package*.json ./

# Dar permisos antes de instalar
RUN chown -R pptruser:pptruser /app \
 && chmod -R 755 /app

# Cambiar a usuario pptruser (el que usa esta imagen)
USER pptruser

# Instalar dependencias como ese usuario
RUN npm install

# Copiar el resto del código
COPY --chown=pptruser:pptruser . .

EXPOSE 3000

CMD ["npm", "start"]