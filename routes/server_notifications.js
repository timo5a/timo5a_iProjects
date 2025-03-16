// server_notifications.js
const WebSocket = require('ws');
const express = require('express');

// Создаём маршрутизатор Express
const router = express.Router();

// Храним подключённых клиентов
const clients = new Map();

// Инициализация WebSocket и уведомлений
function initNotifications(pool, sessionStore, server) {
    const wss = new WebSocket.Server({ noServer: true });

    // Настройка WebSocket
    server.on('upgrade', (request, socket, head) => {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    });

    // Подключение WebSocket
    wss.on('connection', (ws, req) => {
        const url = new URL(req.url, 'http://localhost:3000');
        const sessionId = url.searchParams.get('sessionId');

        sessionStore.get(sessionId, (err, sessionData) => {
            if (err || !sessionData || !sessionData.user) {
                console.log('WebSocket: Неверный sessionId или неавторизован', err);
                ws.close(1008, 'Unauthorized');
                return;
            }
            const userId = sessionData.user.id;
            ws.userId = userId;
            clients.set(userId, ws);
            console.log(`WebSocket: Подключён клиент ${userId}`);
            ws.on('close', () => {
                clients.delete(userId);
                console.log(`Клиент ${userId} отключился`);
            });
        });
    });

    // Настройка LISTEN для PostgreSQL
    pool.connect((err, client) => {
        if (err) {
            console.error('Ошибка подключения к базе для LISTEN:', err);
            return;
        }
        client.query('LISTEN stock_notifications_changed');
        client.on('notification', (msg) => {
            const productId = parseInt(msg.payload);
            console.log(`Получено уведомление для productId: ${productId}`);
            notifySubscribers(productId, pool);
        });
    });

    return { wss };
}

// Функция отправки уведомлений
async function notifySubscribers(productId, pool) {
    try {
        console.log(`Уведомляем подписчиков о продукте ${productId}`);
        const result = await pool.query(
            'SELECT user_id FROM stock_notifications WHERE product_id = $1 AND notified = TRUE',
            [productId]
        );
        const subscribers = result.rows.map(row => row.user_id);

        subscribers.forEach(userId => {
            const ws = clients.get(userId);
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ productId, notifiedCount: subscribers.length }));
                console.log(`Отправлено уведомление пользователю ${userId}`);
            }
        });
    } catch (err) {
        console.error('Ошибка в notifySubscribers:', err);
    }
}

// Передаём pool в запросы
router.use((req, res, next) => {
    req.pool = req.app.locals.pool;
    next();
});

// Маршрут для страницы уведомлений
router.get('/', async (req, res) => {
    if (!req.session.user) {
        return res.status(403).render('error', { 
            layout: 'layout',
            pageTitle: 'Доступ запрещён',
            message: 'Войдите, чтобы просмотреть уведомления.',
            link: { url: '/login', text: 'Перейти на страницу входа' },
            user: null,
            isAdminPage: false 
        });
    }
    try {
        const userId = req.session.user.id;
        const notificationsResult = await req.pool.query(
            'SELECT p.id, p.name, sn.notified FROM stock_notifications sn JOIN products p ON sn.product_id = p.id WHERE sn.user_id = $1',
            [userId]
        );
        const notifications = notificationsResult.rows;

        await req.pool.query(
            'DELETE FROM stock_notifications WHERE user_id = $1 AND notified = TRUE',
            [userId]
        );

        res.render('notifications', { 
            layout: 'layout',
            notifications,
            pageTitle: 'Мои уведомления о поступлении', 
            user: req.session.user || null,
            isAdminPage: false 
        });
    } catch (err) {
        console.error('Ошибка при получении уведомлений:', err);
        res.status(500).send('Произошла ошибка при получении уведомлений.');
    }
});

module.exports = { initNotifications, router, notifySubscribers };