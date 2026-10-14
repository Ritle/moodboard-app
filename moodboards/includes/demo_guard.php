<?php
session_start();

$password = 'demo123';

if (!isset($_SESSION['demo'])) {
    if (isset($_POST['password']) && $_POST['password'] === $password) {
        $_SESSION['demo'] = true;
    } else {
        echo '<form method="post">
            <input type="password" name="password" placeholder="Пароль">
            <button type="submit">Войти</button>
        </form>';
        exit;
    }
}

// здесь дальше обычный код страницы
?>
