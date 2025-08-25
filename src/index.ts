import express from 'express';
import bodyParser from 'body-parser';

import {positions, accountBalance} from './capital'
import { position } from './binance';

const app = express();
app.use(bodyParser.json())

app.get('/', (req, res) => {
  res.send('servidor activo activo');
});

app.get('/capital_balance', (req, res) => {
  res.send(accountBalance())
})

app.post('/capital_position',(req,res) => {

  const payload = req.body;
  console.log(payload)
  try{
    positions(payload.epic, payload.size, payload.type)
    res.send('posicion realizada!')
  }catch(e){
    console.log(e)
    res.send('Error al realizar la posicion')
  }
})

app.get('/binance', (req, res) => {
  res.send(position())
})


const port = parseInt(process.env.PORT || '3000');
app.listen(port, () => {
  console.log(`listening on port ${port}`);
});
