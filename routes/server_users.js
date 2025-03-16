//GET /register
//POST /register
//GET /login
//POST /login
//GET /logout

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt'); // Убедись, что установлено: npm install bcrypt

// Вход
router.get('/login', (req, res) => {
    if (req.session.user) {
        return res.redirect('/products');
    }
    res.render('login', { 
        layout: 'layout',
        pageTitle: 'Вход', 
        user: req.session.user || null,
        isAdminPage: false,
        sessionID: req.sessionID
    });
});

router.post('/login', async (req, res) => {
    console.log('--- Новый POST-запрос на /login ---');
    console.log('Тело запроса:', req.body);
    if (!req.pool) {
        console.error('Ошибка: req.pool не определён');
        return res.status(500).json({ success: false, message: 'Ошибка подключения к базе данных' });
    }
    const { username, password } = req.body;
    console.log('Попытка входа с:', { username, password });
    try {
        const result = await req.pool.query(
            'SELECT * FROM users WHERE username = $1',
            [username]
        );
        console.log('Результат запроса:', result.rows);
        if (result.rows.length === 0) {
            return res.json({ success: false, message: 'Неверное имя пользователя или пароль' });
        }
        const user = result.rows[0];
        const isMatch = await bcrypt.compare(password, user.password);
        console.log('Пароль совпадает:', isMatch);
        if (isMatch) {
            req.session.user = user;
            console.log('Сессия сохранена:', req.session.user);
            res.json({ success: true });
        } else {
            res.json({ success: false, message: 'Неверное имя пользователя или пароль' });
        }
    } catch (err) {
        console.error('Ошибка при входе:', err);
        res.status(500).json({ success: false, message: 'Ошибка сервера: ' + err.message });
    }
});


// Регистрация
router.get('/register', (req, res) => {
    if (req.session.user) {
        return res.redirect('/products');
    }
    res.render('register', { 
        layout: 'layout',
        pageTitle: 'Регистрация', 
        user: req.session.user || null,
        isAdminPage: false,
        sessionID: req.sessionID
    });
});

router.post('/register', async (req, res) => {
    const { username, email, password } = req.body;
    console.log('Получено для регистрации:', { username, email, password });
    try {
        if (!req.pool) {
            console.error('Ошибка: req.pool не определён');
            return res.status(500).json({ success: false, message: 'Ошибка подключения к базе данных' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        await req.pool.query(
            'INSERT INTO users (username, email, password, is_admin) VALUES ($1, $2, $3, FALSE)',
            [username, email || null, hashedPassword]
        );
        console.log('Пользователь зарегистрирован:', username);
        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка при регистрации:', err);
        res.status(500).json({ success: false, message: 'Ошибка сервера: ' + err.message });
    }
});

router.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login');
    });
});

module.exports = router;