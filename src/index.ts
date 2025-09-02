import express from 'express';
import bodyParser from 'body-parser';
import { dbconection } from './config/db';

import {positions, accountBalance} from './capital'
import { position } from './binance';

const app = express();

dbconection();
app.use(bodyParser.json())

app.get('/', (req, res) => {
  res.send('servidor activo activo');
});

app.get('/capital_balance', (req, res) => {
  res.send(accountBalance())
})

app.post('/capital_position', async (req,res) => {

  const payload = req.body;
  console.log(payload)
  try{
  let result = await positions(payload.epic, payload.size, payload.type, payload.strategy)
    res.send({data: result})
  }catch(e){
    console.log(e)
    res.send('Error al realizar la posicion')
  }
})


app.post('/binance', (req, res) => {
  const payload = req.body;
  res.send(position(payload.type))
})


const port = parseInt(process.env.PORT || '3000');
app.listen(port, () => {
  console.log(`listening on port ${port}`);
});
