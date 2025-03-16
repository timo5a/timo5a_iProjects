const express = require('express');
const path = require('path');
const expressLayouts = require('express-ejs-layouts');
const { Pool } = require('pg');
const session = require('express-session');
const MemoryStore = require('express-session/session/memory');
const productRoutes = require('./routes/server_products');
const userRoutes = require('./routes/server_users');
const adminRoutes = require('./routes/server_admin');
const wishlistRoutes = require('./routes/server_wishlist');
const { initNotifications, router: notificationsRoutes, notifySubscribers } = require('./routes/server_notifications');

const app = express();
const pool = new Pool({
    user: 'testik',
    host: 'localhost',
    database: 'my_online_store_test',
    password: 'pass',
    port: 5432,
    client_encoding: 'utf8'
});

const sessionStore = new MemoryStore();
app.set('sessionStore', sessionStore); // Для HTTP-запросов
app.use(session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    store: sessionStore
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
    console.log(`Requesting: ${req.method} ${req.url}`);
    res.locals.sessionID = req.sessionID;
    res.locals.user = req.session.user;
    req.pool = app.locals.pool;
    next();
});

app.locals.pool = pool;
// Добавь отладку маршрутов
console.log('Подключение маршрута POST /login:', userRoutes.stack.find(layer => layer.route && layer.route.path === '/login' && layer.route.methods.post));

app.use(userRoutes);
app.use(productRoutes);
app.use(wishlistRoutes);
app.use('/admin', adminRoutes);
app.use('/notifications', notificationsRoutes);

// Создание таблиц (можно оставить здесь или вынести в отдельный файл)
pool.query(`
    CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100),
        price NUMERIC,
        description TEXT,
        image_url VARCHAR(255),
        category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        average_rating NUMERIC DEFAULT 0,
        review_count INTEGER DEFAULT 0
    )
`).then(() => console.log('Таблица продуктов создана или уже существует')).catch(err => console.error('Ошибка:', err));

pool.query(`
    CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        is_admin BOOLEAN DEFAULT FALSE
    )
`).then(() => console.log('Таблица пользователей создана или уже существует')).catch(err => console.error('Ошибка:', err));

pool.query(`
    CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) UNIQUE NOT NULL
    )
`).then(() => console.log('Таблица категорий создана или уже существует')).catch(err => console.error('Ошибка:', err));

pool.query(`
    CREATE TABLE IF NOT EXISTS carts (
        user_id INTEGER,
        product_id INTEGER,
        quantity INTEGER,
        PRIMARY KEY (user_id, product_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    )
`).then(() => console.log('Таблица корзины создана или уже существует')).catch(err => console.error('Ошибка:', err));

pool.query(`
    CREATE TABLE IF NOT EXISTS reviews (
        id SERIAL PRIMARY KEY,
        product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        rating INTEGER CHECK (rating >= 1 AND rating <= 5),
        comment TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`).then(() => console.log('Таблица отзывов создана или уже существует')).catch(err => console.error('Ошибка:', err));

pool.query(`
    CREATE TABLE IF NOT EXISTS wishlist (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (user_id, product_id)
    )
`).then(() => console.log('Таблица wishlist создана или уже существует')).catch(err => console.error('Ошибка:', err));

pool.query(`
    CREATE TABLE IF NOT EXISTS stock_notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (user_id, product_id)
    )
`).then(() => console.log('Таблица уведомлений о поступлении создана или уже существует')).catch(err => console.error('Ошибка:', err));

// Главная страница
app.get('/', (req, res) => {
    console.log('Достигнут маршрут GET /');
    res.redirect('/products');
});

// Запуск сервера и WebSocket
const server = app.listen(3000, () => {
    console.log('Сервер запущен на http://localhost:3000');
    console.log('WebSocket на ws://localhost:3000');
});

// Инициализация WebSocket и уведомлений
const { wss } = initNotifications(pool, sessionStore, server);

// Проверка подключения к базе
pool.connect((err) => {
    if (err) console.error('Ошибка подключения к базе:', err);
    else console.log('База данных подключена');
});