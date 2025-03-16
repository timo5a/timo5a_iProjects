const express = require('express');
const router = express.Router();

// Middleware для доступа к pool
router.use((req, res, next) => {
    req.pool = req.app.locals.pool;
    next();
});

// Просмотр списка желаний
router.get('/wishlist', async (req, res) => {
    if (!req.session.user) {
        return res.status(403).send('Только авторизованные пользователи могут просматривать список желаний.');
    }
    try {
        const userId = req.session.user.id;
        const result = await req.pool.query(
            'SELECT p.*, c.name AS category_name FROM wishlist w JOIN products p ON w.product_id = p.id LEFT JOIN categories c ON p.category_id = c.id WHERE w.user_id = $1 ORDER BY w.created_at DESC',
            [userId]
        );
        const wishlistItems = result.rows.map(item => ({
            ...item,
            price: parseFloat(item.price)
        }));

        res.render('wishlist', { 
            wishlistItems,
            pageTitle: 'Список желаний', 
            user: req.session.user || null,
            isAdminPage: false 
        });
    } catch (err) {
        console.error('Ошибка при получении списка желаний:', err);
        res.status(500).send('Произошла ошибка при получении списка желаний.');
    }
});

// Добавление товара в список желаний
router.post('/add-to-wishlist/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(403).json({ success: false, message: 'Только авторизованные пользователи могут добавлять товары в избранное.' });
    }
    try {
        const productId = parseInt(req.params.id, 10);
        const userId = req.session.user.id;

        const existing = await req.pool.query(
            'SELECT * FROM wishlist WHERE user_id = $1 AND product_id = $2',
            [userId, productId]
        );
        if (existing.rows.length === 0) {
            await req.pool.query(
                'INSERT INTO wishlist (user_id, product_id) VALUES ($1, $2)',
                [userId, productId]
            );
            res.status(200).json({ success: true, message: 'Товар добавлен в избранное.' });
        } else {
            res.status(200).json({ success: false, message: 'Товар уже в списке желаний.' });
        }
    } catch (err) {
        console.error('Ошибка при добавлении в избранное:', err);
        res.status(500).json({ success: false, message: 'Произошла ошибка при добавлении в избранное.' });
    }
});

// Удаление товара из списка желаний
router.post('/remove-from-wishlist/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(403).json({ success: false, message: 'Только авторизованные пользователи могут удалять товары из избранного.' });
    }
    try {
        const productId = parseInt(req.params.id, 10);
        const userId = req.session.user.id;

        await req.pool.query(
            'DELETE FROM wishlist WHERE user_id = $1 AND product_id = $2',
            [userId, productId]
        );
        res.status(200).json({ success: true });
    } catch (err) {
        console.error('Ошибка при удалении из избранного:', err);
        res.status(500).json({ success: false, message: 'Произошла ошибка при удалении из избранного.' });
    }
});

module.exports = router;