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

CREATE TABLE game_awards (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    category VARCHAR(255) NOT NULL,
    appid VARCHAR(20) NOT NULL,
    year INT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(steam_id) ON DELETE CASCADE,
    UNIQUE KEY unique_vote (user_id, category, year)
);

CREATE TABLE community_awards (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    category VARCHAR(255) NOT NULL,
    voted_option VARCHAR(255) NOT NULL,
    year INT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(steam_id) ON DELETE CASCADE,
    UNIQUE KEY unique_vote (user_id, category, year)
);
