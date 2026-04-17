# Stage 1: Build da aplicação React/Vite
FROM node:20-alpine AS build

# Passar as variáveis no momento do build
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY

# Converter os argumentos de build em variáveis de ambiente disponíveis na run de build
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY

# Diretório de trabalho dentro do container
WORKDIR /app

# Copia os arquivos de configuração de dependências
COPY package.json package-lock.json* ./

# Instala as dependências (preferencialmente com npm ci se houver package-lock, fallback pra npm install)
RUN npm install

# Copia todo o código para o container
COPY . .

# Faz o build (gera a pasta /dist que será servida)
RUN npm run build

# Stage 2: Serve a aplicação usando Nginx (imagem levíssima)
FROM nginx:alpine

# Remove os arquivos de configuração padrão do nginx
RUN rm /etc/nginx/conf.d/default.conf

# Copia nossa configuração para suportar React Router
COPY nginx.conf /etc/nginx/conf.d/

# Copia os arquivos do build (da Stage 1) para a pasta servida pelo nginx
COPY --from=build /app/dist /usr/share/nginx/html

# Expõe a porta 80
EXPOSE 80

# Inicia o nginx sem rodar em background
CMD ["nginx", "-g", "daemon off;"]
