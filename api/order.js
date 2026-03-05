.insert([{ 
  name: name, 
  phone: phone, 
  service: task, // Здесь 'service' — это название колонки в базе, а 'task' — данные из формы
  address: address, // Эту колонку мы сейчас добавили
  date: new Date().toISOString(), 
  status: 'new' 
}]);
