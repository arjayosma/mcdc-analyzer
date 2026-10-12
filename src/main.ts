import './styles.css';
import { mountApp } from './ui/App';

const root = document.querySelector<HTMLDivElement>('#app');
if (root) mountApp(root);
