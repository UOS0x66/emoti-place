import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET;

function signToken(userId) {
  return jwt.sign({ userId }, SECRET, { expiresIn: '24h' });
}

function verifyToken(token) {
  return jwt.verify(token, SECRET);
}

export { signToken, verifyToken };
