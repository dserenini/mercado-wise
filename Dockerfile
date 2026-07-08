# Stage 1: Build da aplicação React/Vite
FROM node:20-alpine AS build

WORKDIR /app

# Instala dependências de forma reproduzível (usa o package-lock)
COPY package.json package-lock.json* ./
RUN npm ci

# Copia o código
COPY . .

# Variáveis PÚBLICAS do Vite injetadas em build time (o .env é ignorado por
# segurança, então os valores públicos entram por build-args via docker-compose).
# ATENÇÃO: nunca passe segredos (service_role, Gemini) aqui — vão parar no bundle.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_SUPABASE_PROJECT_ID
ARG VITE_API_URL
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY \
    VITE_SUPABASE_PROJECT_ID=$VITE_SUPABASE_PROJECT_ID \
    VITE_API_URL=$VITE_API_URL

RUN npm run build

# Stage 2: Serve com Nginx (imagem levíssima)
FROM nginx:alpine

RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
