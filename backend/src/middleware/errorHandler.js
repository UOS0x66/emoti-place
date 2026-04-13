function errorHandler(err, req, res, _next) {
  console.error('[Error]', err.message);
  console.error(err.stack);

  res.status(err.status || 500).json({
    error: err.message || '서버 내부 오류가 발생했습니다.',
  });
}

module.exports = errorHandler;
