CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    steam_name VARCHAR(255),
    steam_id VARCHAR(255) UNIQUE,
    steam_avatar VARCHAR(255),
    is_participating BOOLEAN DEFAULT FALSE
);

CREATE TABLE santa_pairings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    recipient_id VARCHAR(255) NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(steam_id) ON DELETE CASCADE,
    FOREIGN KEY (recipient_id) REFERENCES users(steam_id) ON DELETE CASCADE
);
