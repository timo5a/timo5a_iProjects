const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const pool = new Pool({
    user: 'timo5a',
    host: 'localhost',
    database: 'my_online_store',
    password: 'H3IWOAyfoGWloggVLte7', // Замените на ваш реальный пароль
    port: 5432,
});

module.exports = function(passport) {
    passport.use(new LocalStrategy(
        async (username, password, done) => {
            const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
            if (result.rows.length === 0) {
                return done(null, false, { message: 'Неправильное имя пользователя или пароль' });
            }

            const user = result.rows[0];
            const isMatch = await bcrypt.compare(password, user.password);

            if (isMatch) {
                return done(null, user);
            } else {
                return done(null, false, { message: 'Неправильное имя пользователя или пароль' });
            }
        }
    ));

    passport.serializeUser((user, done) => {
        done(null, user.id);
    });

    passport.deserializeUser(async (id, done) => {
        const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
        done(null, result.rows[0]);
    });
};