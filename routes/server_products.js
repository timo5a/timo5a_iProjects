const express = require('express');
const router = express.Router();
const { notifySubscribers } = require('./server_notifications');

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
            return subscribers;
        }
    }
    return [];
}

// Список товаров
router.get('/products', async (req, res) => {
    try {
        const { search, minPrice, maxPrice, category, sort } = req.query;
        let query = 'SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id';
        let queryParams = [];
        let conditions = [];

        if (search) {
            conditions.push('p.name ILIKE $' + (queryParams.length + 1));
            queryParams.push(`%${search}%`);
        }
        if (minPrice) {
            conditions.push('p.price >= $' + (queryParams.length + 1));
            queryParams.push(parseFloat(minPrice));
        }
        if (maxPrice) {
            conditions.push('p.price <= $' + (queryParams.length + 1));
            queryParams.push(parseFloat(maxPrice));
        }
        if (category && category !== 'all') {
            conditions.push('c.id = $' + (queryParams.length + 1));
            queryParams.push(parseInt(category));
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        if (sort) {
            switch (sort) {
                case 'price_asc': query += ' ORDER BY p.price ASC'; break;
                case 'price_desc': query += ' ORDER BY p.price DESC'; break;
                case 'name_asc': query += ' ORDER BY p.name ASC'; break;
                case 'name_desc': query += ' ORDER BY p.name DESC'; break;
            }
        }

        const result = await req.pool.query(query, queryParams);
        const products = result.rows.map(product => ({
            ...product,
            price: parseFloat(product.price),
            stock: product.stock || 0
        }));

        const categoriesResult = await req.pool.query('SELECT id, name FROM categories');
        const categories = categoriesResult.rows;

        let wishlistIds = [];
        if (req.session.user) {
            const wishlistResult = await req.pool.query('SELECT product_id FROM wishlist WHERE user_id = $1', [req.session.user.id]);
            wishlistIds = wishlistResult.rows.map(row => row.product_id);
        }

        res.render('products', { 
            layout: 'layout',
            products,
            searchQuery: search || '',
            minPrice: minPrice || '',
            maxPrice: maxPrice || '',
            category: category || 'all',
            sort: sort || '',
            categories,
            pageTitle: 'Каталог товаров',
            user: req.session.user || null,
            isAdminPage: false,
            wishlistIds,
            sessionID: req.sessionID
        });
    } catch (err) {
        console.error('Ошибка при получении списка товаров:', err);
        res.status(500).send('Произошла ошибка при получении списка товаров.');
    }
});

// Детали товара
router.get('/product/:id', async (req, res) => {
    const productId = req.params.id;
    try {
        const productResult = await req.pool.query(
            'SELECT * FROM products WHERE id = $1',
            [productId]
        );
        if (productResult.rows.length === 0) {
            return res.status(404).send('Товар не найден');
        }
        const product = productResult.rows[0];
        product.price = Number(product.price);

        const relatedResult = await req.pool.query(
            'SELECT * FROM products WHERE category_id = $1 AND id != $2 LIMIT 4',
            [product.category_id, productId]
        );
        const relatedProducts = relatedResult.rows.map(p => {
            p.price = Number(p.price);
            return p;
        });

        const reviewsResult = await req.pool.query(
            'SELECT r.*, u.username FROM reviews r JOIN users u ON r.user_id = u.id WHERE r.product_id = $1 ORDER BY r.created_at DESC',
            [productId]
        );
        const reviews = reviewsResult.rows;

        // Добавляем wishlistIds
        let wishlistIds = [];
        if (req.session.user) {
            const wishlistResult = await req.pool.query(
                'SELECT product_id FROM wishlist WHERE user_id = $1',
                [req.session.user.id]
            );
            wishlistIds = wishlistResult.rows.map(row => row.product_id);
        }

        res.render('product', {
            layout: 'layout',
            pageTitle: product.name,
            product: product,
            relatedProducts: relatedProducts,
            reviews: reviews,
            wishlistIds: wishlistIds, // Всегда передаём, даже если пустой массив
            user: req.session.user || null,
            sessionID: req.sessionID
        });
    } catch (err) {
        console.error('Ошибка при загрузке товара:', err);
        res.status(500).send('Ошибка сервера');
    }
});

// Добавление в корзину
router.post('/add-to-cart/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(403).json({ success: false, message: 'Войдите в систему' });
    }
    const productId = parseInt(req.params.id);
    const userId = req.session.user.id;

    try {
        // Проверяем наличие товара и его stock
        const productResult = await req.pool.query(
            'SELECT stock FROM products WHERE id = $1',
            [productId]
        );
        if (productResult.rows.length === 0) {
            return res.json({ success: false, message: 'Товар не найден' });
        }
        const stock = productResult.rows[0].stock || 0;
        if (stock < 1) {
            return res.json({ success: false, message: 'Товара нет в наличии' });
        }

        // Проверяем, есть ли товар в корзине
        const existing = await req.pool.query(
            'SELECT quantity FROM carts WHERE user_id = $1 AND product_id = $2',
            [userId, productId]
        );
        if (existing.rows.length > 0) {
            const currentQuantity = existing.rows[0].quantity;
            if (currentQuantity + 1 > stock) {
                return res.json({ success: false, message: `Доступно только ${stock} шт.` });
            }
            await req.pool.query(
                'UPDATE carts SET quantity = quantity + 1 WHERE user_id = $1 AND product_id = $2',
                [userId, productId]
            );
        } else {
            await req.pool.query(
                'INSERT INTO carts (user_id, product_id, quantity) VALUES ($1, $2, 1)',
                [userId, productId]
            );
        }

        // Уменьшаем stock в products
        await req.pool.query(
            'UPDATE products SET stock = stock - 1 WHERE id = $1',
            [productId]
        );

        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка при добавлении в корзину:', err);
        res.json({ success: false, message: 'Произошла ошибка при добавлении товара в корзину.' });
    }
});

// Добавление отзыва
router.post('/review/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(403).send('Только авторизованные пользователи могут оставлять отзывы.');
    }
    try {
        const productId = parseInt(req.params.id, 10);
        const { rating, comment } = req.body;
        const userId = req.session.user.id;

        await req.pool.query(
            'INSERT INTO reviews (product_id, user_id, rating, comment) VALUES ($1, $2, $3, $4)',
            [productId, userId, parseInt(rating), comment || '']
        );

        await req.pool.query(
            'UPDATE products SET average_rating = (SELECT AVG(rating) FROM reviews WHERE product_id = $1), review_count = (SELECT COUNT(*) FROM reviews WHERE product_id = $1) WHERE id = $1',
            [productId]
        );

        res.redirect(`/product/${productId}`);
    } catch (err) {
        console.error('Ошибка при добавлении отзыва:', err);
        res.status(500).send('Произошла ошибка при добавлении отзыва.');
    }
});

// Просмотр корзины
router.get('/cart', async (req, res) => {
    try {
        let cart = [];
        if (req.session.user) {
            const userId = req.session.user.id;
            const cartResult = await req.pool.query(`
                SELECT p.id, p.name, p.price, p.image_url, p.stock, c.quantity
                FROM carts c
                JOIN products p ON c.product_id = p.id
                WHERE c.user_id = $1
            `, [userId]);
            cart = cartResult.rows.map(item => ({
                ...item,
                price: parseFloat(item.price),
                stock: item.stock || 0
            }));
            res.render('cart', { 
                layout: 'layout',
                cart, 
                pageTitle: 'Корзина', 
                user: req.session.user || null,
                isAdminPage: false 
            });
        } else {
            res.status(403).render('error', { 
                layout: 'layout',
                pageTitle: 'Доступ запрещён',
                message: 'Войдите, чтобы просмотреть корзину.',
                link: { url: '/login', text: 'Перейти на страницу входа' },
                user: null,
                isAdminPage: false 
            });
        }
    } catch (err) {
        console.error('Ошибка при получении содержимого корзины:', err);
        res.status(500).send('Произошла ошибка при получении содержимого корзины.');
    }
});

// Изменение количества товара в корзине
router.post('/cart/update/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(403).json({ success: false, message: 'Войдите в систему' });
    }
    const productId = parseInt(req.params.id);
    const { quantity } = req.body;
    const userId = req.session.user.id;
    const newQuantity = parseInt(quantity);

    try {
        const stockResult = await req.pool.query(
            'SELECT stock FROM products WHERE id = $1',
            [productId]
        );
        if (stockResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Товар не найден' });
        }

        const cartResult = await req.pool.query(
            'SELECT quantity FROM carts WHERE user_id = $1 AND product_id = $2',
            [userId, productId]
        );
        const oldQuantity = cartResult.rows.length > 0 ? cartResult.rows[0].quantity : 0;

        const quantityDiff = oldQuantity - newQuantity;

        if (newQuantity <= 0) {
            await req.pool.query(
                'DELETE FROM carts WHERE user_id = $1 AND product_id = $2',
                [userId, productId]
            );
        } else {
            if (newQuantity > stockResult.rows[0].stock + oldQuantity) {
                return res.json({ 
                    success: false, 
                    message: `Доступно только ${stockResult.rows[0].stock + oldQuantity} шт. этого товара` 
                });
            }
            await req.pool.query(
                'UPDATE carts SET quantity = $1 WHERE user_id = $2 AND product_id = $3 RETURNING *',
                [newQuantity, userId, productId]
            );
        }

        if (quantityDiff !== 0) {
            await req.pool.query(
                'UPDATE products SET stock = stock + $1 WHERE id = $2',
                [quantityDiff, productId]
            );
            if (quantityDiff > 0) {
                await checkStockNotifications(req.pool, productId);
                await notifySubscribers(productId, req.pool);
            }
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка при обновлении корзины:', err);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// Удаление из корзины
router.post('/remove-from-cart/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(403).send('Войдите в систему');
    }
    try {
        const userId = req.session.user.id;
        const productId = parseInt(req.params.id, 10);
        const cartResult = await req.pool.query(
            'DELETE FROM carts WHERE user_id = $1 AND product_id = $2 RETURNING quantity',
            [userId, productId]
        );
        if (cartResult.rowCount > 0) {
            const quantity = cartResult.rows[0].quantity || 1;
            await req.pool.query(
                'UPDATE products SET stock = stock + $1 WHERE id = $2',
                [quantity, productId]
            );
            await checkStockNotifications(req.pool, productId);
            await notifySubscribers(productId, req.pool); // Используем импортированный notifySubscribers
        }
        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка при удалении из корзины:', err);
        res.status(500).json({ success: false, message: 'Ошибка при удалении из корзины.' });
    }
});

// Уведомления (страница)
router.get('/notifications', async (req, res) => {
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

        // Очищаем notified после просмотра
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

// Подписка на уведомление о поступлении
router.post('/notify-me/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(403).json({ success: false, message: 'Войдите, чтобы подписаться на уведомления.' });
    }
    try {
        const productId = parseInt(req.params.id, 10);
        const userId = req.session.user.id;

        const existing = await req.pool.query(
            'SELECT * FROM stock_notifications WHERE user_id = $1 AND product_id = $2',
            [userId, productId]
        );
        if (existing.rows.length > 0) {
            return res.status(200).json({ success: false, message: 'Вы уже подписаны на уведомление.' });
        }

        await req.pool.query(
            'INSERT INTO stock_notifications (user_id, product_id, notified) VALUES ($1, $2, FALSE)',
            [userId, productId]
        );
        res.status(200).json({ success: true, message: 'Вы подписаны на уведомление о поступлении.' });
    } catch (err) {
        console.error('Ошибка при подписке на уведомление:', err);
        res.status(500).json({ success: false, message: 'Произошла ошибка при подписке.' });
    }
});

module.exports = router;