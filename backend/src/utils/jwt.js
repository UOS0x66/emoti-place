const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;

function signToken(userId) {
  return jwt.sign({ userId }, SECRET, { expiresIn: '24h' });
}

function verifyToken(token) {
  return jwt.verify(token, SECRET);
}

module.exports = { signToken, verifyToken };
