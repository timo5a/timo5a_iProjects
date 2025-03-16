//GET /admin
//GET /admin/users
//POST /admin/delete-user
//POST /admin/ban-user
//еще есть

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt'); // Оставляем, хотя пока не используется в админке

router.use((req, res, next) => {
    req.pool = req.app.locals.pool;
    next();
});

// Вспомогательная функция для проверки уведомлений
async function checkStockNotifications(pool, productId) {
    const productResult = await pool.query('SELECT stock FROM products WHERE id = $1', [productId]);
    const newStock = productResult.rows[0].stock || 0;

    if (newStock > 0) {
        const subscribersResult = await pool.query(
            'SELECT user_id FROM stock_notifications WHERE product_id = $1 AND notified = FALSE',
            [productId]
        );
        const subscribers = subscribersResult.rows.map(row => row.user_id);

        if (subscribers.length > 0) {
            await pool.query(
                'UPDATE stock_notifications SET notified = TRUE WHERE product_id = $1 AND notified = FALSE',
                [productId]
            );
            console.log(`Товар ${productId} поступил на склад. Уведомляем пользователей: ${subscribers.join(', ')}`);
            // Здесь можно добавить дополнительную логику отправки уведомлений (например, email)
        }
    }
}

// Админская панель
router.get('/', (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) {
        return res.status(403).send('Доступ запрещён');
    }
    res.render('admin', { 
        pageTitle: 'Админ-панель', 
        user: req.session.user || null, 
        isAdminPage: true
    });
});

// Список пользователей (только для админов)
router.get('/admin/users', async (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) {
        return res.status(403).send('Доступ запрещён.');
    }
    try {
        const result = await req.pool.query('SELECT id, username, email, is_admin FROM users ORDER BY id');
        res.render('admin_users', { 
            pageTitle: 'Список пользователей', 
            users: result.rows, 
            user: req.session.user || null,
            isAdminPage: true 
        });
    } catch (err) {
        console.error('Ошибка при получении списка пользователей:', err);
        res.status(500).send('Произошла ошибка при получении списка пользователей.');
    }
});

// Удаление пользователя
router.post('/admin/delete-user/:id', async (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) {
        return res.status(403).send('Доступ запрещён.');
    }
    try {
        const userId = parseInt(req.params.id, 10);
        await req.pool.query('DELETE FROM users WHERE id = $1', [userId]);
        res.redirect('/admin/users');
    } catch (err) {
        console.error('Ошибка при удалении пользователя:', err);
        res.status(500).send('Произошла ошибка при удалении пользователя.');
    }
});

// Бан пользователя (переключение is_admin)
router.post('/admin/ban-user/:id', async (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) {
        return res.status(403).send('Доступ запрещён.');
    }
    try {
        const userId = parseInt(req.params.id, 10);
        await req.pool.query('UPDATE users SET is_admin = FALSE WHERE id = $1', [userId]);
        res.redirect('/admin/users');
    } catch (err) {
        console.error('Ошибка при бане пользователя:', err);
        res.status(500).send('Произошла ошибка при бане пользователя.');
    }
});

// Список товаров для редактирования (только для админов)
router.get('/products', async (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) {
        return res.status(403).send('Доступ запрещён.');
    }
    try {
        const result = await req.pool.query('SELECT * FROM products ORDER BY id');
        const categoriesResult = await req.pool.query('SELECT id, name FROM categories');
        const categories = categoriesResult.rows;
        res.render('admin_products', { 
            pageTitle: 'Управление ассортиментом', 
            products: result.rows, 
            categories, 
            user: req.session.user || null,
            isAdminPage: true 
        });
    } catch (err) {
        console.error('Ошибка при получении списка товаров:', err);
        res.status(500).send('Произошла ошибка при получении списка товаров.');
    }
});

// Обновление товара
router.post('/update-product/:id', async (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) {
        return res.status(403).send('Доступ запрещён.');
    }
    try {
        const productId = parseInt(req.params.id, 10);
        const { name, price, description, image_url, category_id, stock } = req.body;

        await req.pool.query(
            'UPDATE products SET name = $1, price = $2, description = $3, image_url = $4, category_id = $5, stock = $6 WHERE id = $7',
            [name, parseFloat(price), description, image_url, category_id || null, parseInt(stock) || 0, productId]
        );

        await checkStockNotifications(req.pool, productId);
        const { notifySubscribers } = require('./server_notifications');
        await notifySubscribers(productId, req.pool);

        const userId = req.session.user.id;
        const notifiedCountResult = await req.pool.query(
            'SELECT COUNT(*) FROM stock_notifications WHERE user_id = $1 AND notified = TRUE',
            [userId]
        );
        req.session.notifiedCount = parseInt(notifiedCountResult.rows[0].count, 10);

        res.redirect('/admin/products');
    } catch (err) {
        console.error('Ошибка при обновлении товара:', err);
        res.status(500).send('Произошла ошибка при обновлении товара.');
    }
});

// Отображение формы для добавления товаров
router.get('/add-product', (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) {
        return res.status(403).send('Доступ запрещён. Только администраторы могут добавлять товары.');
    }
    req.pool.query('SELECT id, name FROM categories')
        .then(categoriesResult => {
            const categories = categoriesResult.rows;
            res.render('add_product', { 
                pageTitle: 'Добавить новый товар', 
                user: req.session.user || null,
                isAdminPage: true,
                categories 
            });
        })
        .catch(err => {
            console.error('Ошибка при получении категорий:', err);
            res.status(500).send('Произошла ошибка при получении категорий.');
        });
});

// Обработка массового добавления товаров
router.post('/add-product', async (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) {
        return res.status(403).send('Доступ запрещён. Только администраторы могут добавлять товары.');
    }
    try {
        const { products } = req.body;
        const validProducts = products.filter(p => p.name && p.price);

        if (validProducts.length > 0) {
            for (const product of validProducts) {
                await req.pool.query(
                    'INSERT INTO products (name, price, description, image_url, category_id) VALUES ($1, $2, $3, $4, $5)',
                    [product.name, parseFloat(product.price), product.description || '', product.image_url || '', product.category_id ? parseInt(product.category_id) : null]
                );
            }
        }
        res.redirect('/admin/products');
    } catch (err) {
        console.error('Ошибка при добавлении товаров:', err);
        res.status(500).send('Произошла ошибка при добавлении товаров.');
    }
});

module.exports = router;